import Foundation
import Speech

/// What an on-device transcription attempt produced. `unavailable` is an
/// expected state (speech access denied, no on-device model for the
/// language), never an error: the memo just waits for a later pass.
enum OnDeviceTranscription {
  case text(String)
  case unavailable(String)
}

/// Audio-memo transcription on the phone itself, through Apple's speech
/// engine with `requiresOnDeviceRecognition` — no audio leaves the device and
/// no API key is involved. Free of any Tauri dependency so it stays a plain
/// Foundation/Speech unit.
///
/// The recognizer follows the device language (`SFSpeechRecognizer()`), the
/// same language the system keyboard dictates in.
enum OnDeviceTranscriber {
  /// In-flight recognitions, retained until their callback fires: a
  /// recognizer or task released mid-run cancels the recognition.
  private static var inFlight: [UUID: (SFSpeechRecognizer, SFSpeechRecognitionTask)] = [:]

  /// Transcribe one audio file. `completion` runs exactly once, on the main
  /// queue.
  static func transcribe(
    fileURL: URL,
    completion: @escaping (Result<OnDeviceTranscription, Error>) -> Void
  ) {
    SFSpeechRecognizer.requestAuthorization { status in
      DispatchQueue.main.async {
        guard status == .authorized else {
          completion(.success(.unavailable(deniedReason(status))))
          return
        }
        start(fileURL: fileURL, completion: completion)
      }
    }
  }

  private static func start(
    fileURL: URL,
    completion: @escaping (Result<OnDeviceTranscription, Error>) -> Void
  ) {
    guard let recognizer = SFSpeechRecognizer() else {
      completion(.success(.unavailable("Speech recognition does not support this device's language.")))
      return
    }
    guard recognizer.supportsOnDeviceRecognition else {
      completion(
        .success(
          .unavailable(
            "On-device speech recognition is not available for \(recognizer.locale.identifier) on this iPhone."
          )))
      return
    }
    let request = SFSpeechURLRecognitionRequest(url: fileURL)
    request.requiresOnDeviceRecognition = true
    request.shouldReportPartialResults = false
    request.taskHint = .dictation
    if #available(iOS 16.0, *) {
      request.addsPunctuation = true
    }

    let id = UUID()
    var finished = false
    let finish = { (result: Result<OnDeviceTranscription, Error>) in
      guard !finished else { return }
      finished = true
      inFlight[id] = nil
      completion(result)
    }
    // The recognizer's default queue is the main queue, so the handler and
    // `inFlight` stay on one thread.
    let task = recognizer.recognitionTask(with: request) { result, error in
      if let result, result.isFinal {
        finish(.success(.text(result.bestTranscription.formattedString)))
      } else if let error {
        finish(isNoSpeech(error) ? .success(.text("")) : .failure(error))
      }
    }
    if !finished {
      inFlight[id] = (recognizer, task)
    }
  }

  private static func deniedReason(_ status: SFSpeechRecognizerAuthorizationStatus) -> String {
    status == .restricted
      ? "Speech recognition is restricted on this iPhone."
      : "Speech recognition is off for Kore. Turn it on in Settings > Kore to transcribe audio memos on this iPhone."
  }

  /// The speech service reports silence as an error, not an empty result.
  private static func isNoSpeech(_ error: Error) -> Bool {
    let nsError = error as NSError
    return nsError.domain == "kAFAssistantErrorDomain" && (nsError.code == 1110 || nsError.code == 203)
  }
}
