//! Native memory accounting. RSS alone omits nonresident memory charged to a
//! process; macOS exposes physical footprint and its lifetime peak separately.

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessMemory {
    pub resident_bytes: u64,
    pub footprint_bytes: u64,
    pub peak_footprint_bytes: u64,
}

/// Read Apple resource accounting for a live process. Unsupported platforms
/// and failed observations return `None`, never a fabricated zero footprint.
#[cfg(any(target_os = "macos", target_os = "ios"))]
pub fn read(pid: u32) -> Option<ProcessMemory> {
    let mut info = std::mem::MaybeUninit::<libc::rusage_info_v4>::zeroed();
    // SAFETY: RUSAGE_INFO_V4 writes exactly rusage_info_v4 into this aligned,
    // writable buffer. The libc signature uses an opaque pointer-to-buffer.
    let result = unsafe {
        libc::proc_pid_rusage(
            pid.try_into().ok()?,
            libc::RUSAGE_INFO_V4,
            info.as_mut_ptr().cast(),
        )
    };
    if result != 0 {
        return None;
    }
    // SAFETY: the successful call initialized the v4 buffer.
    let info = unsafe { info.assume_init() };
    Some(ProcessMemory {
        resident_bytes: info.ri_resident_size,
        footprint_bytes: info.ri_phys_footprint,
        peak_footprint_bytes: info.ri_lifetime_max_phys_footprint,
    })
}

#[cfg(not(any(target_os = "macos", target_os = "ios")))]
pub fn read(_pid: u32) -> Option<ProcessMemory> {
    None
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    #[test]
    fn reports_self_and_does_not_invent_a_measurement_for_an_invalid_pid() {
        let memory = super::read(std::process::id()).expect("self resource accounting");
        assert!(memory.footprint_bytes > 0);
        assert!(memory.resident_bytes > 0);
        assert!(memory.peak_footprint_bytes >= memory.footprint_bytes);
        assert!(super::read(u32::MAX).is_none());
    }
}
