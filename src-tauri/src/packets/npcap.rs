use libloading::{Library, Symbol};
use log::{info, warn};
use std::ffi::{CStr, CString};
use std::path::PathBuf;
use std::ptr;
use std::sync::Arc;
use std::sync::OnceLock;

// Type definitions for pcap functions
type PcapFindAllDevs = unsafe extern "C" fn(*mut *mut PcapIf, *mut i8) -> i32;
type PcapFreeAllDevs = unsafe extern "C" fn(*mut PcapIf);
type PcapCreate = unsafe extern "C" fn(*const i8, *mut i8) -> *mut PcapT;
type PcapSetSnaplen = unsafe extern "C" fn(*mut PcapT, i32) -> i32;
type PcapSetPromisc = unsafe extern "C" fn(*mut PcapT, i32) -> i32;
type PcapSetTimeout = unsafe extern "C" fn(*mut PcapT, i32) -> i32;
type PcapSetBufferSize = unsafe extern "C" fn(*mut PcapT, i32) -> i32;
type PcapActivate = unsafe extern "C" fn(*mut PcapT) -> i32;
type PcapClose = unsafe extern "C" fn(*mut PcapT);
type PcapNextEx = unsafe extern "C" fn(*mut PcapT, *mut *mut PcapPkthdr, *mut *const u8) -> i32;
type PcapGetErr = unsafe extern "C" fn(*mut PcapT) -> *mut i8;
type PcapDataLink = unsafe extern "C" fn(*mut PcapT) -> i32;
type PcapCompile = unsafe extern "C" fn(*mut PcapT, *mut BpfProgram, *const i8, i32, u32) -> i32;
type PcapSetFilter = unsafe extern "C" fn(*mut PcapT, *mut BpfProgram) -> i32;
type PcapFreeCode = unsafe extern "C" fn(*mut BpfProgram);
type PcapSetImmediateMode = unsafe extern "C" fn(*mut PcapT, i32) -> i32;
type PcapHandler = unsafe extern "C" fn(*mut u8, *const PcapPkthdr, *const u8);
type PcapDispatch = unsafe extern "C" fn(*mut PcapT, i32, PcapHandler, *mut u8) -> i32;

const NPCAP_SNAPLEN: i32 = 65_536;
const NPCAP_PROMISC: i32 = 1;
const NPCAP_TIMEOUT_MS: i32 = 1_000;
const NPCAP_BUFFER_SIZE: i32 = 64 * 1024 * 1024;
const NPCAP_IMMEDIATE: i32 = 1;
const NPCAP_BPF_FILTER: &str = "tcp and not portrange 0-1000";

#[repr(C)]
pub struct PcapIf {
    pub next: *mut PcapIf,
    pub name: *mut i8,
    pub description: *mut i8,
    pub addresses: *mut PcapAddr,
    pub flags: u32,
}

#[repr(C)]
pub struct PcapAddr {
    pub next: *mut PcapAddr,
    pub addr: *mut libc::sockaddr,
    pub netmask: *mut libc::sockaddr,
    pub broadaddr: *mut libc::sockaddr,
    pub dstaddr: *mut libc::sockaddr,
}

#[repr(C)]
pub struct PcapPkthdr {
    pub ts: libc::timeval,
    pub caplen: u32,
    pub len: u32,
}

#[repr(C)]
struct BpfProgram {
    bf_len: u32,
    bf_insns: *mut BpfInsn,
}

#[repr(C)]
struct BpfInsn {
    code: u16,
    jt: u8,
    jf: u8,
    k: u32,
}

pub enum PcapT {}

pub struct NpcapContext {
    lib: Arc<Library>,
    dll_path: PathBuf,
}

impl NpcapContext {
    pub fn new() -> Result<Self, String> {
        unsafe {
            let mut errors = Vec::new();
            for candidate in npcap_dll_candidates() {
                if !candidate.is_file() {
                    errors.push(format!("{}: missing", candidate.display()));
                    continue;
                }
                match load_npcap_library(&candidate) {
                    Ok(lib) => {
                        info!(
                            target: "app::capture",
                            "Loaded Npcap library from {}",
                            candidate.display()
                        );
                        return Ok(Self {
                            lib: Arc::new(lib),
                            dll_path: candidate,
                        });
                    }
                    Err(error) => {
                        errors.push(format!("{}: {}", candidate.display(), error));
                    }
                }
            }

            Err(format!(
                "Failed to load Npcap wpcap.dll: {}",
                errors.join("; ")
            ))
        }
    }

    pub fn list_devices(&self) -> Result<Vec<Device>, String> {
        let mut devices = Vec::new();
        unsafe {
            let find_all_devs: Symbol<PcapFindAllDevs> = self
                .lib
                .get(b"pcap_findalldevs")
                .map_err(|e| e.to_string())?;
            let free_all_devs: Symbol<PcapFreeAllDevs> = self
                .lib
                .get(b"pcap_freealldevs")
                .map_err(|e| e.to_string())?;

            let mut alldevs: *mut PcapIf = ptr::null_mut();
            let mut errbuf = [0i8; 256];

            if find_all_devs(&mut alldevs, errbuf.as_mut_ptr()) == -1 {
                return Err(CStr::from_ptr(errbuf.as_ptr())
                    .to_string_lossy()
                    .into_owned());
            }

            let mut curr = alldevs;
            while !curr.is_null() {
                let name = CStr::from_ptr((*curr).name).to_string_lossy().into_owned();
                let description = if !(*curr).description.is_null() {
                    Some(
                        CStr::from_ptr((*curr).description)
                            .to_string_lossy()
                            .into_owned(),
                    )
                } else {
                    None
                };

                devices.push(Device { name, description });
                curr = (*curr).next;
            }

            free_all_devs(alldevs);
        }
        Ok(devices)
    }
}

fn npcap_dll_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(system_root) = std::env::var_os("SystemRoot") {
        candidates.push(
            PathBuf::from(system_root)
                .join("System32")
                .join("Npcap")
                .join("wpcap.dll"),
        );
    }
    candidates.push(PathBuf::from(r"C:\Windows\System32\Npcap\wpcap.dll"));
    candidates
}

#[cfg(windows)]
unsafe fn load_npcap_library(path: &PathBuf) -> Result<Library, libloading::Error> {
    use libloading::os::windows::{
        LOAD_LIBRARY_SEARCH_DEFAULT_DIRS, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR,
        Library as WindowsLibrary,
    };

    unsafe {
        WindowsLibrary::load_with_flags(
            path.as_os_str(),
            LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_DEFAULT_DIRS,
        )
    }
    .map(Library::from)
}

#[cfg(not(windows))]
unsafe fn load_npcap_library(path: &PathBuf) -> Result<Library, libloading::Error> {
    Library::new(path.as_os_str())
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct Device {
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NpcapDiagnostics {
    pub detected: bool,
    pub dll_path: Option<String>,
    pub error: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub fn get_network_devices() -> Result<Vec<Device>, String> {
    let context = NpcapContext::new()?;
    context.list_devices()
}

#[tauri::command]
#[specta::specta]
pub fn check_npcap_status() -> bool {
    NpcapContext::new().is_ok()
}

#[tauri::command]
#[specta::specta]
pub fn get_npcap_diagnostics() -> NpcapDiagnostics {
    match NpcapContext::new() {
        Ok(context) => NpcapDiagnostics {
            detected: true,
            dll_path: Some(context.dll_path.display().to_string()),
            error: None,
        },
        Err(error) => NpcapDiagnostics {
            detected: false,
            dll_path: npcap_dll_candidates()
                .into_iter()
                .find(|path| path.is_file())
                .map(|path| path.display().to_string()),
            error: Some(error),
        },
    }
}

pub struct NpcapCapture {
    handle: *mut PcapT,
    #[allow(dead_code)] // Kept alive to ensure cached function pointers remain valid.
    lib: Arc<Library>,
    data_link: i32,
    #[allow(dead_code)] // Fallback path retained for diagnostics.
    fn_next_ex: PcapNextEx,
    fn_get_err: PcapGetErr,
    fn_close: PcapClose,
    fn_dispatch: PcapDispatch,
}

unsafe impl Send for NpcapCapture {}

impl NpcapCapture {
    pub fn new(device_name: &str) -> Result<Self, String> {
        let context = NpcapContext::new()?;
        unsafe {
            let create = load_symbol::<PcapCreate>(&context.lib, b"pcap_create")?;
            let set_snaplen = load_symbol::<PcapSetSnaplen>(&context.lib, b"pcap_set_snaplen")?;
            let set_promisc = load_symbol::<PcapSetPromisc>(&context.lib, b"pcap_set_promisc")?;
            let set_timeout = load_symbol::<PcapSetTimeout>(&context.lib, b"pcap_set_timeout")?;
            let set_buffer_size =
                load_symbol::<PcapSetBufferSize>(&context.lib, b"pcap_set_buffer_size")?;
            let set_immediate = match load_symbol::<PcapSetImmediateMode>(
                &context.lib,
                b"pcap_set_immediate_mode",
            ) {
                Ok(symbol) => Some(symbol),
                Err(err) => {
                    warn!(
                        "Npcap immediate mode unavailable for device {}: {}; continuing without immediate mode",
                        device_name, err
                    );
                    None
                }
            };
            let activate = load_symbol::<PcapActivate>(&context.lib, b"pcap_activate")?;
            let close = load_symbol::<PcapClose>(&context.lib, b"pcap_close")?;
            let get_err = load_symbol::<PcapGetErr>(&context.lib, b"pcap_geterr")?;
            let data_link_fn = load_symbol::<PcapDataLink>(&context.lib, b"pcap_datalink")?;
            let bpf_filter_fns = match (
                load_symbol::<PcapCompile>(&context.lib, b"pcap_compile"),
                load_symbol::<PcapSetFilter>(&context.lib, b"pcap_setfilter"),
                load_symbol::<PcapFreeCode>(&context.lib, b"pcap_freecode"),
            ) {
                (Ok(compile), Ok(set_filter), Ok(free_code)) => {
                    Some((compile, set_filter, free_code))
                }
                (compile, set_filter, free_code) => {
                    warn!(
                        "Npcap BPF filter unavailable for device {}: {}; {}; {}; continuing without kernel filter",
                        device_name,
                        compile
                            .err()
                            .unwrap_or_else(|| "pcap_compile available".to_string()),
                        set_filter
                            .err()
                            .unwrap_or_else(|| "pcap_setfilter available".to_string()),
                        free_code
                            .err()
                            .unwrap_or_else(|| "pcap_freecode available".to_string())
                    );
                    None
                }
            };

            let fn_next_ex = load_symbol::<PcapNextEx>(&context.lib, b"pcap_next_ex")?;
            let fn_get_err = get_err;
            let fn_close = close;
            let fn_dispatch = load_symbol::<PcapDispatch>(&context.lib, b"pcap_dispatch")?;

            let device_c = CString::new(device_name).map_err(|e| e.to_string())?;
            let mut errbuf = [0i8; 256];

            let handle = create(device_c.as_ptr(), errbuf.as_mut_ptr());

            if handle.is_null() {
                return Err(CStr::from_ptr(errbuf.as_ptr())
                    .to_string_lossy()
                    .into_owned());
            }

            let configure = || -> Result<(), String> {
                if set_snaplen(handle, NPCAP_SNAPLEN) != 0 {
                    return Err(format!(
                        "pcap_set_snaplen failed: {}",
                        pcap_error(get_err, handle)
                    ));
                }
                if set_promisc(handle, NPCAP_PROMISC) != 0 {
                    return Err(format!(
                        "pcap_set_promisc failed: {}",
                        pcap_error(get_err, handle)
                    ));
                }
                if set_timeout(handle, NPCAP_TIMEOUT_MS) != 0 {
                    return Err(format!(
                        "pcap_set_timeout failed: {}",
                        pcap_error(get_err, handle)
                    ));
                }
                if let Some(set_immediate) = set_immediate {
                    if set_immediate(handle, NPCAP_IMMEDIATE) != 0 {
                        warn!(
                            "pcap_set_immediate_mode failed for device {}: {}; continuing without immediate mode",
                            device_name,
                            pcap_error(get_err, handle)
                        );
                    }
                }
                if set_buffer_size(handle, NPCAP_BUFFER_SIZE) != 0 {
                    return Err(format!(
                        "pcap_set_buffer_size failed: {}",
                        pcap_error(get_err, handle)
                    ));
                }

                let activate_result = activate(handle);
                if activate_result < 0 {
                    return Err(format!(
                        "pcap_activate failed ({}): {}",
                        activate_result,
                        pcap_error(get_err, handle)
                    ));
                }
                if activate_result > 0 {
                    warn!(
                        "pcap_activate warning ({}) for device {}: {}",
                        activate_result,
                        device_name,
                        pcap_error(get_err, handle)
                    );
                }

                if let Some((compile, set_filter, free_code)) = bpf_filter_fns {
                    if let Err(err) = set_bpf_filter(
                        handle,
                        compile,
                        set_filter,
                        free_code,
                        get_err,
                        NPCAP_BPF_FILTER,
                    ) {
                        warn!(
                            "Npcap BPF filter failed for device {}: {}; continuing without kernel filter",
                            device_name, err
                        );
                    }
                }

                Ok(())
            };

            if let Err(err) = configure() {
                close(handle);
                return Err(err);
            }

            info!(
                "Npcap handle configured device={} buffer_size={} bytes snaplen={} timeout_ms={} immediate={} filter={}",
                device_name,
                NPCAP_BUFFER_SIZE,
                NPCAP_SNAPLEN,
                NPCAP_TIMEOUT_MS,
                NPCAP_IMMEDIATE,
                NPCAP_BPF_FILTER
            );

            let data_link = data_link_fn(handle);
            static LOGGED_DLT: OnceLock<i32> = OnceLock::new();
            if LOGGED_DLT.set(data_link).is_ok() {
                info!(
                    "Npcap datalink type for device {}: {}",
                    device_name, data_link
                );
            }

            Ok(Self {
                handle,
                lib: context.lib,
                data_link,
                fn_next_ex,
                fn_get_err,
                fn_close,
                fn_dispatch,
            })
        }
    }

    pub fn datalink(&self) -> i32 {
        self.data_link
    }

    #[allow(dead_code)]
    pub fn next_packet(&self) -> Result<Option<Vec<u8>>, String> {
        unsafe {
            let mut header: *mut PcapPkthdr = ptr::null_mut();
            let mut data: *const u8 = ptr::null();

            let res = (self.fn_next_ex)(self.handle, &mut header, &mut data);

            match res {
                1 => {
                    // Success
                    let len = (*header).caplen as usize;
                    let packet_data = std::slice::from_raw_parts(data, len).to_vec();
                    Ok(Some(packet_data))
                }
                0 => Ok(None), // Timeout
                -1 => Err(format!(
                    "Error reading packet: {}",
                    pcap_error(self.fn_get_err, self.handle)
                )),
                -2 => Ok(None), // EOF
                _ => Err(format!("Unknown pcap_next_ex return code: {}", res)),
            }
        }
    }

    /// Dispatch up to `max` packets through one libpcap call.
    ///
    /// The slice passed to `on_packet` is only valid during the callback.
    /// Panics are caught inside the FFI trampoline so they cannot unwind across
    /// libpcap.
    pub fn dispatch_batch<F: FnMut(&[u8])>(
        &self,
        max: i32,
        on_packet: &mut F,
    ) -> Result<i32, String> {
        unsafe extern "C" fn trampoline<F: FnMut(&[u8])>(
            user: *mut u8,
            header: *const PcapPkthdr,
            data: *const u8,
        ) {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| unsafe {
                let callback = &mut *(user as *mut F);
                let len = (*header).caplen as usize;
                let slice = std::slice::from_raw_parts(data, len);
                callback(slice);
            }));
            if result.is_err() {
                log::error!("panic caught inside pcap_dispatch callback");
            }
        }

        let user_ptr = on_packet as *mut F as *mut u8;
        let res = unsafe { (self.fn_dispatch)(self.handle, max, trampoline::<F>, user_ptr) };

        match res {
            n if n >= 0 => Ok(n),
            -1 => Err(format!("pcap_dispatch error: {}", unsafe {
                pcap_error(self.fn_get_err, self.handle)
            })),
            -2 => Ok(0), // breakloop; treat as an empty dispatch.
            other => Err(format!("pcap_dispatch unknown return: {}", other)),
        }
    }
}

fn load_symbol<T: Copy>(lib: &Library, name: &'static [u8]) -> Result<T, String> {
    let display_name = String::from_utf8_lossy(name)
        .trim_end_matches('\0')
        .to_string();
    unsafe { lib.get::<T>(name) }
        .map(|symbol| *symbol)
        .map_err(|e| format!("GetProcAddress failed for {}: {}", display_name, e))
}

unsafe fn pcap_error(get_err: PcapGetErr, handle: *mut PcapT) -> String {
    let err = unsafe { get_err(handle) };
    if err.is_null() {
        "unknown pcap error".to_string()
    } else {
        unsafe { CStr::from_ptr(err) }
            .to_string_lossy()
            .into_owned()
    }
}

fn set_bpf_filter(
    handle: *mut PcapT,
    compile: PcapCompile,
    set_filter: PcapSetFilter,
    free_code: PcapFreeCode,
    get_err: PcapGetErr,
    filter: &str,
) -> Result<(), String> {
    let filter_c = CString::new(filter).map_err(|e| e.to_string())?;
    let mut program = BpfProgram {
        bf_len: 0,
        bf_insns: ptr::null_mut(),
    };

    let compile_result = unsafe { compile(handle, &mut program, filter_c.as_ptr(), 1, 0) };
    if compile_result != 0 {
        return Err(format!(
            "pcap_compile failed for filter {:?}: {}",
            filter,
            unsafe { pcap_error(get_err, handle) }
        ));
    }

    let set_result = unsafe { set_filter(handle, &mut program) };
    unsafe {
        free_code(&mut program);
    }

    if set_result != 0 {
        return Err(format!(
            "pcap_setfilter failed for filter {:?}: {}",
            filter,
            unsafe { pcap_error(get_err, handle) }
        ));
    }

    Ok(())
}

impl Drop for NpcapCapture {
    fn drop(&mut self) {
        unsafe {
            (self.fn_close)(self.handle);
        }
    }
}
