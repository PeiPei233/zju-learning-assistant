//! Keep DWM's caption buttons while extending the WebView into the title bar.
//! Keep the WebView intact so dialogs and their masks can cover the title bar.
use std::ptr::null_mut;
use std::sync::atomic::{AtomicI32, Ordering};
static INTERACTIVE_LEFT_WIDTH: AtomicI32 = AtomicI32::new(0);
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM},
    Graphics::Dwm::{
        DwmDefWindowProc, DwmExtendFrameIntoClientArea, DwmSetWindowAttribute, DWMWA_TEXT_COLOR,
    },
    UI::{
        Controls::MARGINS,
        HiDpi::{GetDpiForWindow, GetSystemMetricsForDpi},
        Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
        WindowsAndMessaging::*,
    },
};

// App-local Windows App SDK runtime, built and bundled with the application.
mod acrylic_runtime {
    use super::*;
    use std::{os::windows::ffi::OsStrExt, sync::OnceLock};
    use windows_sys::Win32::System::LibraryLoader::{
        GetProcAddress, LoadLibraryExW, LOAD_LIBRARY_SEARCH_DEFAULT_DIRS,
        LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR,
    };
    type Init = unsafe extern "C" fn(HWND) -> i32;
    type Theme = unsafe extern "C" fn(HWND, i32) -> i32;
    type Active = unsafe extern "C" fn(i32);
    type Frame = unsafe extern "C" fn(HWND, i32);
    type Layout = unsafe extern "C" fn(HWND, i32, i32, i32, i32, u32);
    type Close = unsafe extern "C" fn();
    struct Api {
        frame: Frame,
        layout: Layout,
        theme: Theme,
        active: Active,
        close: Close,
    }
    static API: OnceLock<Api> = OnceLock::new();
    pub const THEME_MESSAGE: u32 = WM_APP + 57;
    pub unsafe fn install(hwnd: HWND) {
        let Ok(exe) = std::env::current_exe() else {
            return;
        };
        let path = exe.with_file_name("zju_acrylic.dll");
        let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let dll = LoadLibraryExW(
            wide.as_ptr(),
            null_mut(),
            LOAD_LIBRARY_SEARCH_DEFAULT_DIRS | LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR,
        );
        if dll.is_null() {
            eprintln!(
                "Acrylic DLL load failed: {}",
                std::io::Error::last_os_error()
            );
            return;
        }
        let (Some(init), Some(theme), Some(active), Some(close), Some(layout), Some(frame)) = (
            GetProcAddress(dll, b"acrylic_init\0".as_ptr()),
            GetProcAddress(dll, b"acrylic_theme\0".as_ptr()),
            GetProcAddress(dll, b"acrylic_active\0".as_ptr()),
            GetProcAddress(dll, b"acrylic_close\0".as_ptr()),
            GetProcAddress(dll, b"acrylic_layout\0".as_ptr()),
            GetProcAddress(dll, b"acrylic_frame\0".as_ptr()),
        ) else {
            eprintln!("Acrylic DLL exports missing");
            return;
        };
        let init: Init = std::mem::transmute(init);
        let hr = init(hwnd);
        eprintln!("App SDK Acrylic init: {hr:#x}");
        if hr >= 0 {
            let _ = API.set(Api {
                frame: std::mem::transmute(frame),
                layout: std::mem::transmute(layout),
                theme: std::mem::transmute(theme),
                active: std::mem::transmute(active),
                close: std::mem::transmute(close),
            });
        }
    }
    pub fn available() -> bool {
        API.get().is_some()
    }
    pub unsafe fn frame(hwnd: HWND, top: i32) -> bool {
        if let Some(api) = API.get() {
            (api.frame)(hwnd, top);
            true
        } else {
            false
        }
    }
    pub unsafe fn layout(hwnd: HWND, left: i32, width: i32, height: i32, opaque: bool, color: u32) {
        if let Some(api) = API.get() {
            (api.layout)(hwnd, left, width, height, opaque as i32, color);
        }
    }
    pub unsafe fn theme(hwnd: HWND, dark: bool) {
        if let Some(api) = API.get() {
            (api.theme)(hwnd, dark as i32);
        }
    }
    pub unsafe fn active(active: bool) {
        if let Some(api) = API.get() {
            (api.active)(active as i32);
        }
    }
    pub unsafe fn close() {
        if let Some(api) = API.get() {
            (api.close)();
        }
    }
}

pub fn has_native_backdrop() -> bool {
    acrylic_runtime::available()
}

const SUBCLASS_ID: usize = 0x5a4a55;
const CHROME_HEIGHT: u32 = 38;

pub fn set_theme(window: &tauri::WebviewWindow, dark: bool) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|error| error.to_string())?.0 as HWND;
    // Let DWM supply the same translucent backdrop across the entire titlebar.
    // Only synchronize the native glyph color with the frontend theme.
    let foreground: u32 = if dark { 0x00dfe4e4 } else { 0x00292929 };
    unsafe {
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_TEXT_COLOR as u32,
            &foreground as *const _ as _,
            4,
        );
    }
    unsafe {
        SendMessageW(hwnd, acrylic_runtime::THEME_MESSAGE, dark as usize, 0);
    }
    Ok(())
}

unsafe fn has_caption(hwnd: HWND) -> bool {
    GetWindowLongPtrW(hwnd, GWL_STYLE) as u32 & WS_CAPTION != 0
}

pub fn install(window: &tauri::WebviewWindow) -> Result<(), Box<dyn std::error::Error>> {
    let hwnd = window.hwnd()?.0 as HWND;
    unsafe {
        if SetWindowSubclass(hwnd, Some(frame_proc), SUBCLASS_ID, 0) == 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        extend_frame(hwnd);
        acrylic_runtime::install(hwnd);
        extend_frame(hwnd);
        SetWindowPos(
            hwnd,
            null_mut(),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
        );
    }
    Ok(())
}

unsafe fn extend_frame(hwnd: HWND) {
    let top = if has_caption(hwnd) {
        (CHROME_HEIGHT * GetDpiForWindow(hwnd) / 96) as i32
    } else {
        0
    };
    if acrylic_runtime::frame(hwnd, top) {
        return;
    }
    let margins = MARGINS {
        cxLeftWidth: 0,
        cxRightWidth: 0,
        cyTopHeight: top,
        cyBottomHeight: 0,
    };
    DwmExtendFrameIntoClientArea(hwnd, &margins);
}

unsafe extern "system" fn frame_proc(
    hwnd: HWND,
    msg: u32,
    wp: WPARAM,
    lp: LPARAM,
    _: usize,
    _: usize,
) -> LRESULT {
    if msg == WM_APP + 58 {
        let layout = &*(lp as *const ChromeLayout);
        INTERACTIVE_LEFT_WIDTH.store(layout.left, Ordering::Relaxed);
        acrylic_runtime::layout(
            hwnd,
            layout.left,
            layout.width,
            layout.height,
            layout.opaque,
            layout.color,
        );
        return 0;
    }
    if msg == acrylic_runtime::THEME_MESSAGE {
        acrylic_runtime::theme(hwnd, wp != 0);
        return 0;
    }
    if msg == WM_ACTIVATE {
        acrylic_runtime::active((wp & 0xffff) != WA_INACTIVE as usize);
    }
    if msg == WM_NCCALCSIZE && wp != 0 && has_caption(hwnd) {
        let rect = &mut (*(lp as *mut NCCALCSIZE_PARAMS)).rgrc[0];
        // Preserve native resize borders and the maximized work-area inset.
        let dpi = GetDpiForWindow(hwnd);
        let x = GetSystemMetricsForDpi(SM_CXSIZEFRAME, dpi)
            + GetSystemMetricsForDpi(SM_CXPADDEDBORDER, dpi);
        let y = GetSystemMetricsForDpi(SM_CYSIZEFRAME, dpi)
            + GetSystemMetricsForDpi(SM_CXPADDEDBORDER, dpi);
        rect.left += x;
        rect.right -= x;
        rect.bottom -= y;
        if IsZoomed(hwnd) != 0 {
            rect.top += y;
        }
        return 0;
    }
    let mut hit = 0;
    let handled = has_caption(hwnd) && DwmDefWindowProc(hwnd, msg, wp, lp, &mut hit) != 0;
    if msg == WM_NCHITTEST && has_caption(hwnd) {
        // DWM can return HTCLIENT for its extended caption when maximized.
        // Like Electron's WCO, explicitly identify caption controls to Windows.
        let mut client: RECT = std::mem::zeroed();
        let mut origin = windows_sys::Win32::Foundation::POINT { x: 0, y: 0 };
        GetClientRect(hwnd, &mut client);
        windows_sys::Win32::Graphics::Gdi::ClientToScreen(hwnd, &mut origin);
        let x = (lp as i16) as i32 - origin.x;
        let y = ((lp >> 16) as i16) as i32 - origin.y;
        let dpi = GetDpiForWindow(hwnd);
        let width = (46 * dpi / 96) as i32;
        let height = (CHROME_HEIGHT * dpi / 96) as i32;
        let from_right = client.right - x;
        // Keep frontend controls outside the native caption hit-test region.
        if x >= 0
            && x < INTERACTIVE_LEFT_WIDTH.load(Ordering::Relaxed)
            && y >= (4 * dpi / 96) as i32
            && y < height
        {
            return HTCLIENT as isize;
        }
        if y >= 0 && y < height && from_right > 0 && from_right <= 3 * width {
            return if from_right <= width {
                HTCLOSE
            } else if from_right <= 2 * width {
                HTMAXBUTTON
            } else {
                HTMINBUTTON
            } as isize;
        }
    }
    if handled {
        return hit;
    }
    if msg == WM_NCHITTEST {
        let result = DefSubclassProc(hwnd, msg, wp, lp);
        if result != HTCLIENT as isize {
            return result;
        }
        let mut rect: RECT = std::mem::zeroed();
        GetWindowRect(hwnd, &mut rect);
        let y = ((lp >> 16) as i16) as i32;
        if IsZoomed(hwnd) == 0 && y < rect.top + (4 * GetDpiForWindow(hwnd) / 96) as i32 {
            return HTTOP as isize;
        }
        return result;
    }
    if msg == WM_NCDESTROY {
        acrylic_runtime::close();
        RemoveWindowSubclass(hwnd, Some(frame_proc), SUBCLASS_ID);
    }
    let result = DefSubclassProc(hwnd, msg, wp, lp);
    if matches!(msg, WM_SIZE | WM_DPICHANGED | WM_ACTIVATE | WM_THEMECHANGED) {
        extend_frame(hwnd);
    }
    result
}

#[repr(C)]
struct ChromeLayout {
    left: i32,
    width: i32,
    height: i32,
    opaque: bool,
    color: u32,
}
pub unsafe fn set_layout(
    hwnd: usize,
    left: i32,
    width: i32,
    height: i32,
    opaque: bool,
    color: u32,
) {
    let layout = ChromeLayout {
        left,
        width,
        height,
        opaque,
        color,
    };
    SendMessageW(hwnd as HWND, WM_APP + 58, 0, &layout as *const _ as isize);
}
