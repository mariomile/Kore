import SwiftUI
import UIKit

/// The share sheet: a live preview of how the link or the files will land,
/// an optional thought, **Where** (today, a note, a new note) and, for a link,
/// **How** (the link looks the editor offers), then one Save button. Everything is pre-filled from
/// the last share, so a repeat share is a single tap. Colors and radii are
/// Kore's design tokens (`design-system/tokens/colors.css`), mirrored in
/// `KoreColor` below. Like the iPhone app it is monochrome: the primary action
/// is the foreground ink (the tab bar's "+"), selection is a step in the
/// surface ramp, and nothing is painted with the accent.
struct ShareView: View {
    @EnvironmentObject var state: ShareState

    var body: some View {
        NavigationStack {
            Group {
                switch state.status {
                case .loading:
                    Color.clear
                case .ready:
                    ShareForm()
                case .saved:
                    ShareResult(saved: true, failure: nil)
                case let .failed(failure):
                    ShareResult(saved: false, failure: failure)
                }
            }
            .background(KoreColor.app.ignoresSafeArea())
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    if state.status != .saved {
                        CloseButton { state.dismiss() }
                    }
                }
                ToolbarItem(placement: .principal) {
                    HStack(spacing: 7) {
                        KoreMark()
                        Text("Save to Kore").font(.headline)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
            .navigationBarTitleDisplayMode(.inline)
        }
        .tint(KoreColor.text)
        .onAppear { state.load() }
    }
}

// MARK: - the form

private struct ShareForm: View {
    @EnvironmentObject var state: ShareState

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                if state.files.isEmpty {
                    LinkPreview(capture: state.capture, look: state.look, kind: state.kind)
                } else {
                    FilesPreview(files: state.files, leftOut: state.filesLeftOut)
                }
                ThoughtField(text: $state.thought)
                    .padding(.top, 10)
                if state.hasDestination {
                    SectionLabel("Where")
                    WhereGroup()
                }
                if let kind = state.kind {
                    SectionLabel("How")
                    LookPicker(kind: kind, selection: $state.look)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 4)
            .padding(.bottom, 24)
        }
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .bottom) {
            SaveButton(title: saveTitle) { state.save() }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 8)
                .background(KoreColor.app.opacity(0.94))
        }
    }

    private var saveTitle: String {
        switch state.destination {
        case .daily: return "Save to Today"
        case let .note(_, title): return "Save to \(title)"
        case let .new(title, _): return title.isEmpty ? "Save as new note" : "Save as \u{201C}\(title)\u{201D}"
        }
    }
}

// MARK: - preview

/// How the link will look in the note, redrawn as the look changes. Built
/// from what the share carried (title, description, X handle): nothing is
/// fetched, so it is instant and works offline; the note's real card fills
/// in its image once the app opens.
private struct LinkPreview: View {
    let capture: SharedCapture?
    let look: ShareLook
    let kind: ShareContentKind?

    var body: some View {
        Group {
            switch capture {
            case let .link(url, title, selection, description):
                link(url: url, title: title, selection: selection, description: description)
            case let .text(text):
                Text(text)
                    .font(.body)
                    .lineLimit(6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(16)
            case .files, nil:
                EmptyView()
            }
        }
        .background(KoreColor.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .animation(.easeOut(duration: 0.18), value: look)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Preview")
    }

    @ViewBuilder
    private func link(url: String, title: String, selection: String?, description: String?) -> some View {
        let host = URL(string: url)?.host?.replacingOccurrences(of: "www.", with: "") ?? url
        let name = title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? host : title
        let handle = ShareContentKind.xHandle(of: url)
        switch look {
        case .link:
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("•").foregroundColor(KoreColor.muted)
                Text(name)
                    .underline(color: KoreColor.muted)
                    .lineLimit(2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
        case .compact:
            HStack(spacing: 12) {
                SiteTile(host: host, size: 18).frame(width: 32, alignment: .leading)
                Text(name).font(.subheadline.weight(.semibold)).lineLimit(1)
                Spacer(minLength: 8)
                Text(host).font(.caption).foregroundColor(KoreColor.muted).lineLimit(1)
            }
            .padding(16)
        case .card:
            HStack(alignment: .top, spacing: 12) {
                SiteTile(host: host, size: 64)
                VStack(alignment: .leading, spacing: 3) {
                    Text(name).font(.subheadline.weight(.semibold)).lineLimit(2)
                    if let description, !description.isEmpty {
                        Text(description).font(.footnote).foregroundColor(KoreColor.secondary).lineLimit(2)
                    }
                    HostLine(host: host)
                }
                Spacer(minLength: 0)
            }
            .padding(16)
        case .large:
            VStack(alignment: .leading, spacing: 0) {
                SiteTile(host: host, size: nil)
                    .frame(height: 132)
                VStack(alignment: .leading, spacing: 4) {
                    Text(name).font(.headline).lineLimit(2)
                    if let description, !description.isEmpty {
                        Text(description).font(.footnote).foregroundColor(KoreColor.secondary).lineLimit(2)
                    }
                    HostLine(host: host)
                }
                .padding(16)
            }
        case .embed:
            if kind == .post {
                PostPreview(handle: handle ?? host, text: selection ?? description)
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    ZStack {
                        SiteTile(host: host, size: nil)
                        Image(systemName: "play.fill")
                            .font(.system(size: 22, weight: .semibold))
                            .foregroundColor(.white)
                            .frame(width: 52, height: 52)
                            .background(Circle().fill(Color.black.opacity(0.45)))
                    }
                    .frame(height: 150)
                    Text(name).font(.subheadline.weight(.semibold)).lineLimit(2).padding(16)
                }
            }
        case .text where kind == .post:
            PostCardPreview(handle: handle ?? host, text: selection ?? description)
        case .text:
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 12) {
                    SiteTile(host: host, size: 18).frame(width: 32, alignment: .leading)
                    Text(name).font(.subheadline.weight(.semibold)).lineLimit(1)
                }
                Text(quote(selection: selection, description: description))
                    .font(.subheadline)
                    .foregroundColor(KoreColor.secondary)
                    .lineLimit(5)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
                    .background(KoreColor.active)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
        }
    }

    private func quote(selection: String?, description: String?) -> String {
        if let selection, !selection.isEmpty {
            return selection
        }
        switch kind {
        case .video: return "The video\u{2019}s transcript is saved when Kore opens."
        default: return description.map { "\($0)\u{2026}" } ?? "The page\u{2019}s text is saved when Kore opens."
        }
    }
}

/// The post as its card lands in the note: the avatar, the handle over
/// "Post on X", the [[X posts]] pill on the right, then the words. Drawn like
/// the editor's filled X post card (`link-cards.css`).
private struct PostCardPreview: View {
    let handle: String
    let text: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            PostByline(handle: handle) {
                Text("X posts")
                    .font(.caption.weight(.medium))
                    .foregroundColor(KoreColor.secondary)
                    .padding(.horizontal, 9)
                    .frame(height: 24)
                    .background(Capsule().fill(KoreColor.active))
            }
            if let words = text, !words.isEmpty {
                Text(words).font(.subheadline).foregroundColor(KoreColor.secondary).lineLimit(5)
            } else {
                Text("The post\u{2019}s words and photos are saved when Kore opens.")
                    .font(.subheadline)
                    .foregroundColor(KoreColor.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
    }
}

/// A post's first line, as both post looks draw it: the author's initial in a
/// round tile (where the note shows their photo), the handle over "Post on X",
/// and the look's own mark on the right.
private struct PostByline<Trailing: View>: View {
    let handle: String
    @ViewBuilder let trailing: Trailing

    var body: some View {
        HStack(spacing: 12) {
            Circle().fill(KoreColor.activeStrong).frame(width: 32, height: 32)
                .overlay(
                    Text(String(handle.prefix(1)).uppercased())
                        .font(.subheadline.weight(.semibold))
                        .foregroundColor(KoreColor.secondary)
                )
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text("@\(handle)").font(.subheadline.weight(.semibold)).lineLimit(1)
                Text("Post on X").font(.caption).foregroundColor(KoreColor.muted)
            }
            Spacer(minLength: 8)
            trailing
        }
    }
}

private struct PostPreview: View {
    let handle: String
    let text: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            PostByline(handle: handle) {
                Text("𝕏").font(.system(size: 17, weight: .bold)).foregroundColor(KoreColor.text)
            }
            if let words = text, !words.isEmpty {
                Text(words).font(.subheadline).foregroundColor(KoreColor.text).lineLimit(4)
            } else {
                Text("The post draws in full once Kore opens.")
                    .font(.subheadline)
                    .foregroundColor(KoreColor.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
    }
}

/// A placeholder for the page's image: a soft tile with the site's initial.
private struct SiteTile: View {
    let host: String
    let size: CGFloat?

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: size.map { $0 < 24 ? 5 : 10 } ?? 0, style: .continuous)
        shape
            .fill(KoreColor.active)
            .overlay(
                Text(String(host.prefix(1)).uppercased())
                    .font(.system(size: (size ?? 64) * 0.42, weight: .semibold, design: .rounded))
                    .foregroundColor(KoreColor.secondary)
            )
            .frame(width: size, height: size)
            .frame(maxWidth: size == nil ? .infinity : nil)
            .accessibilityHidden(true)
    }
}

private struct HostLine: View {
    let host: String

    var body: some View {
        Text(host).font(.caption).foregroundColor(KoreColor.muted).lineLimit(1).padding(.top, 2)
    }
}

// MARK: - thought

private struct ThoughtField: View {
    @Binding var text: String

    var body: some View {
        // The pencil starts at the same left edge as the Where rows' icons and
        // the post's avatar, inside their 32pt column, so every icon and every
        // text in the sheet share two edges; it is centred on the first line.
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "pencil")
                .font(.system(size: 15, weight: .medium))
                .foregroundColor(KoreColor.muted)
                // The symbol draws 1.7pt inside its own bounds; pull it back so
                // its stroke, not its box, meets the 32pt edge.
                .offset(x: -1.7)
                .frame(width: 32, height: UIFont.preferredFont(forTextStyle: .body).lineHeight, alignment: .leading)
            TextField("Add a thought\u{2026}", text: $text, axis: .vertical)
                .lineLimit(1...4)
                .font(.body)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 13)
        .frame(minHeight: 48)
        .background(KoreColor.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

// MARK: - where

private struct WhereGroup: View {
    @EnvironmentObject var state: ShareState

    var body: some View {
        VStack(spacing: 0) {
            Button {
                state.destination = .daily
            } label: {
                ChoiceRow(icon: "calendar", title: "Today", detail: todayDetail, selected: state.destination == .daily)
            }
            NavigationLink {
                NotePicker()
            } label: {
                ChoiceRow(
                    icon: "doc.text",
                    title: noteTitle ?? "A note\u{2026}",
                    detail: noteDetail ?? "Search your notes",
                    selected: noteTitle != nil,
                    disclosure: noteTitle == nil
                )
            }
            NavigationLink {
                NewNoteForm()
            } label: {
                ChoiceRow(
                    icon: "plus",
                    title: "New note",
                    detail: newDetail,
                    selected: isNew,
                    disclosure: !isNew
                )
            }
        }
        .buttonStyle(.plain)
        .padding(4)
        .background(KoreColor.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var todayDetail: String {
        let formatter = DateFormatter()
        formatter.setLocalizedDateFormatFromTemplate("EEEEdMMMM")
        let date = formatter.string(from: Date())
        return state.landsUnderLinks ? "\(date) \u{00B7} under Links" : date
    }

    private var noteTitle: String? {
        if case let .note(_, title) = state.destination { return title }
        return nil
    }

    private var noteDetail: String? {
        guard case let .note(path, _) = state.destination else { return nil }
        let folder = path.split(separator: "/").dropLast().joined(separator: "/")
        return folder.isEmpty ? "At the end" : "\(folder) \u{00B7} at the end"
    }

    private var isNew: Bool {
        if case .new = state.destination { return true }
        return false
    }

    private var newDetail: String {
        if case let .new(_, folder) = state.destination {
            return folder.isEmpty ? "In the vault\u{2019}s top folder" : "In \(folder)"
        }
        return state.files.isEmpty ? "Named after the page, in a folder" : "Named after the file, in a folder"
    }
}

private struct ChoiceRow: View {
    let icon: String
    let title: String
    let detail: String
    let selected: Bool
    var disclosure = false

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 15, weight: .semibold))
                // Selected, the tile inverts like the tab bar's "+".
                .foregroundColor(selected ? KoreColor.surface : KoreColor.secondary)
                .frame(width: 32, height: 32)
                .background(
                    RoundedRectangle(cornerRadius: 9, style: .continuous)
                        .fill(selected ? KoreColor.text : KoreColor.active)
                )
            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                    .font(.body.weight(.semibold))
                    .foregroundColor(KoreColor.text)
                    .lineLimit(1)
                Text(detail)
                    .font(.footnote)
                    .foregroundColor(KoreColor.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            if selected {
                Image(systemName: "checkmark")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundColor(KoreColor.text)
            } else if disclosure {
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(KoreColor.muted)
            }
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 54)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(selected ? KoreColor.active : Color.clear)
        )
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

private struct NotePicker: View {
    @EnvironmentObject var state: ShareState
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    var body: some View {
        let notes = state.targets.search(query)
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                if notes.isEmpty {
                    Text(state.targets.notes.isEmpty
                        ? "Open Kore once and your notes appear here."
                        : "No note matches \u{201C}\(query)\u{201D}.")
                        .font(.subheadline)
                        .foregroundColor(KoreColor.secondary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 32)
                } else {
                    SectionLabel(query.isEmpty ? "Recent" : "Notes")
                    LazyVStack(spacing: 0) {
                        ForEach(notes) { note in
                            Button {
                                state.destination = .note(path: note.path, title: note.title)
                                dismiss()
                            } label: {
                                ChoiceRow(
                                    icon: "doc.text",
                                    title: note.title,
                                    detail: note.folder.isEmpty ? "Vault" : note.folder,
                                    selected: state.destination == .note(path: note.path, title: note.title)
                                )
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(4)
                    .background(KoreColor.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                    Text(endOfNoteHint)
                        .font(.footnote)
                        .foregroundColor(KoreColor.muted)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 12)
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
        .background(KoreColor.app.ignoresSafeArea())
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search notes")
        .navigationTitle("A note")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var endOfNoteHint: String {
        let noun = state.noun
        let verb = noun.hasSuffix("s") ? "go" : "goes"
        return "The \(noun) \(verb) at the end of the note."
    }
}

private struct NewNoteForm: View {
    @EnvironmentObject var state: ShareState
    @Environment(\.dismiss) private var dismiss
    @FocusState private var titleFocused: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                TextField("Title", text: titleBinding)
                    .font(.title3.weight(.semibold))
                    .focused($titleFocused)
                    .submitLabel(.done)
                    .onSubmit { dismiss() }
                    .padding(.horizontal, 16)
                    .frame(minHeight: 54)
                    .background(KoreColor.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                SectionLabel("Folder")
                VStack(spacing: 0) {
                    ForEach(folders, id: \.self) { folder in
                        Button {
                            setFolder(folder)
                        } label: {
                            ChoiceRow(
                                icon: "folder",
                                title: folder.isEmpty ? "Vault top folder" : folder,
                                detail: detail(for: folder),
                                selected: currentFolder == folder
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(4)
                .background(KoreColor.surface)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                Text("Today gets a link to the new note.")
                    .font(.footnote)
                    .foregroundColor(KoreColor.muted)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 12)
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 24)
        }
        .background(KoreColor.app.ignoresSafeArea())
        .navigationTitle("New note")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Done") { dismiss() }.font(.body.weight(.semibold))
            }
        }
        .onAppear {
            if case .new = state.destination {} else { state.chooseNewNote() }
        }
    }

    /// The vault's default folder and the last one used first, then the most populated.
    private var folders: [String] {
        var ordered: [String] = []
        for folder in [currentFolder, state.targets.newNoteFolder] + state.targets.folders.map(\.path) + [""]
        where !ordered.contains(folder) {
            ordered.append(folder)
        }
        return Array(ordered.prefix(40))
    }

    private var currentFolder: String {
        if case let .new(_, folder) = state.destination { return folder }
        return state.targets.newNoteFolder
    }

    private var titleBinding: Binding<String> {
        Binding(
            get: {
                if case let .new(title, _) = state.destination { return title }
                return state.pageTitle
            },
            set: { state.destination = .new(title: $0, folder: currentFolder) }
        )
    }

    private func setFolder(_ folder: String) {
        if case let .new(title, _) = state.destination {
            state.destination = .new(title: title, folder: folder)
        }
    }

    private func detail(for folder: String) -> String {
        guard let count = state.targets.folders.first(where: { $0.path == folder })?.count else {
            return folder == state.targets.newNoteFolder ? "Where Kore puts new notes" : "Folder"
        }
        return count == 1 ? "1 note" : "\(count) notes"
    }
}

// MARK: - how

private struct LookPicker: View {
    let kind: ShareContentKind
    @Binding var selection: ShareLook

    var body: some View {
        HStack(spacing: 8) {
            ForEach(kind.looks, id: \.self) { look in
                Button {
                    selection = look
                    UISelectionFeedbackGenerator().selectionChanged()
                } label: {
                    VStack(spacing: 7) {
                        LookGlyph(look: look, kind: kind, selected: selection == look)
                            .frame(maxWidth: .infinity)
                            .frame(height: 60)
                            .background(KoreColor.surface)
                            .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: 13, style: .continuous)
                                    .strokeBorder(KoreColor.text, lineWidth: selection == look ? 1.5 : 0)
                            )
                        Text(look.label(for: kind))
                            .font(.footnote.weight(selection == look ? .semibold : .medium))
                            .foregroundColor(selection == look ? KoreColor.text : KoreColor.secondary)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                    }
                    .frame(maxWidth: .infinity)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(look.label(for: kind))
                .accessibilityAddTraits(selection == look ? .isSelected : [])
            }
        }
    }
}

/// A miniature of each look, drawn with the same bars as the web prototype.
/// The selected one draws its bars a step darker.
private struct LookGlyph: View {
    let look: ShareLook
    let kind: ShareContentKind
    let selected: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            switch look {
            case .link:
                bar(0.7)
                bar(0.85, strong: true)
                bar(0.55)
            case .compact:
                HStack(spacing: 5) { block(10, 10); bar(1) }
            case .card:
                HStack(alignment: .top, spacing: 6) {
                    block(20, 20)
                    VStack(alignment: .leading, spacing: 4) { bar(1); bar(0.7) }
                }
            case .large:
                block(nil, 22)
                bar(0.8)
                bar(0.55)
            case .embed:
                if kind == .video {
                    block(nil, 26).overlay(
                        Image(systemName: "play.fill").font(.system(size: 9)).foregroundColor(KoreColor.secondary))
                } else {
                    HStack(spacing: 5) {
                        Circle().fill(ink(barInk)).frame(width: 11, height: 11)
                        bar(0.4)
                        Text("𝕏").font(.system(size: 9, weight: .bold)).foregroundColor(KoreColor.muted)
                    }
                    bar(1)
                    bar(0.75)
                }
            case .text:
                // A filled card, like the post or page quote it stands for.
                VStack(alignment: .leading, spacing: 4) {
                    if kind == .post {
                        HStack(spacing: 4) { Circle().fill(ink(barInk)).frame(width: 7, height: 7); bar(0.4) }
                    }
                    bar(1)
                    bar(0.6)
                }
                .padding(.horizontal, 6)
                .padding(.vertical, 5)
                .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(selected ? KoreColor.activeStrong : KoreColor.active))
            }
        }
        .padding(9)
        .accessibilityHidden(true)
    }

    private func ink(_ amount: Double) -> Color { KoreColor.text.opacity(amount) }

    /// Ink levels: the selected glyph draws everything a step darker.
    private var barInk: Double { selected ? 0.3 : 0.14 }
    private var strongInk: Double { selected ? 1 : 0.34 }
    private var blockInk: Double { selected ? 0.22 : 0.1 }

    private func bar(_ fraction: CGFloat, strong: Bool = false) -> some View {
        GeometryReader { proxy in
            Capsule()
                .fill(ink(strong ? strongInk : barInk))
                .frame(width: proxy.size.width * fraction)
        }
        .frame(height: 5)
    }

    private func block(_ width: CGFloat?, _ height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: 4, style: .continuous)
            .fill(ink(blockInk))
            .frame(width: width, height: height)
            .frame(maxWidth: width == nil ? .infinity : nil)
    }
}

// MARK: - chrome

private struct SectionLabel: View {
    let title: String

    init(_ title: String) {
        self.title = title
    }

    var body: some View {
        Text(title)
            .font(.caption.weight(.semibold))
            .foregroundColor(KoreColor.secondary)
            .padding(.horizontal, 10)
            .frame(height: 24)
            .background(Capsule().fill(KoreColor.active))
            .padding(.top, 18)
            .padding(.bottom, 8)
            .padding(.leading, 2)
            .accessibilityAddTraits(.isHeader)
    }
}

private struct SaveButton: View {
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: "arrow.down.to.line")
                .font(.body.weight(.semibold))
                .lineLimit(1)
                // The foreground ink, like the tab bar's "+" and the capture send.
                .foregroundColor(KoreColor.app)
                .frame(maxWidth: .infinity)
                .frame(height: 52)
                .background(Capsule().fill(KoreColor.text))
        }
        .buttonStyle(PressScale())
    }
}

private struct PressScale: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .opacity(configuration.isPressed ? 0.9 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

private struct CloseButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "xmark")
                .font(.system(size: 13, weight: .bold))
                .foregroundColor(KoreColor.secondary)
                .frame(width: 30, height: 30)
                .background(Circle().fill(KoreColor.active))
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .accessibilityLabel("Cancel")
    }
}

/// The real app icon, at the size iOS draws it beside a share row.
private struct KoreMark: View {
    var body: some View {
        Image("KoreIcon")
            .resizable()
            .frame(width: 22, height: 22)
            .clipShape(RoundedRectangle(cornerRadius: 5, style: .continuous))
            .accessibilityHidden(true)
    }
}

/// The result: a check that confirms where the link went, or an honest failure.
private struct ShareResult: View {
    @EnvironmentObject var state: ShareState
    let saved: Bool
    let failure: ShareFailure?

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: saved ? "checkmark" : "exclamationmark")
                .font(.system(size: 26, weight: .bold))
                .foregroundColor(saved ? KoreColor.success : KoreColor.secondary)
                .frame(width: 64, height: 64)
                .background(Circle().fill(saved ? KoreColor.successSoft : KoreColor.active))
            Text(saved ? savedTitle : "Couldn\u{2019}t save")
                .font(.title3.weight(.semibold))
            if failure == .fileTooLarge {
                Text("Files over 100 MB can\u{2019}t go in the vault.")
                    .font(.subheadline)
                    .foregroundColor(KoreColor.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            }
            if !saved {
                Button("Close") { state.dismiss() }
                    .font(.body.weight(.semibold))
                    .frame(minWidth: 120, minHeight: 44)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear {
            if saved { UINotificationFeedbackGenerator().notificationOccurred(.success) }
        }
    }

    private var savedTitle: String {
        switch state.destination {
        case .daily: return "Saved to Today"
        case let .note(_, title): return "Saved to \(title)"
        case .new: return "Saved as a new note"
        }
    }
}

// MARK: - tokens

/// Kore's color tokens (`design-system/tokens/colors.css`, light `:root` and
/// `.dark`), as dynamic colors that follow the system appearance.
enum KoreColor {
    static let app = dynamic(light: 0xF2F2F4, dark: 0x0C0C0E)
    static let surface = dynamic(light: 0xFFFFFF, dark: 0x17171B)
    static let text = dynamic(light: 0x17181C, dark: 0xEDEDF0)
    static let secondary = dynamic(light: 0x6B6F76, dark: 0x9FA1A7)
    static let muted = dynamic(light: 0x8A8E96, dark: 0x66686F)
    static let active = dynamic(light: 0x121317, dark: 0xFFFFFF, lightAlpha: 0.06, darkAlpha: 0.07)
    /// One step above `active`: a selected tile on a surface.
    static let activeStrong = dynamic(light: 0x121317, dark: 0xFFFFFF, lightAlpha: 0.10, darkAlpha: 0.11)
    static let success = dynamic(light: 0x15703A, dark: 0x4ADE80)
    static let successSoft = dynamic(light: 0x15703A, dark: 0x4ADE80, lightAlpha: 0.1, darkAlpha: 0.12)

    private static func dynamic(
        light: UInt32, dark: UInt32, lightAlpha: CGFloat = 1, darkAlpha: CGFloat = 1
    ) -> Color {
        Color(UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(hex: dark, alpha: darkAlpha)
                : UIColor(hex: light, alpha: lightAlpha)
        })
    }
}

private extension UIColor {
    convenience init(hex: UInt32, alpha: CGFloat) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: alpha
        )
    }
}
