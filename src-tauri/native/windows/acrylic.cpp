#define WIN32_LEAN_AND_MEAN
#include <DispatcherQueue.h>
#include <dwmapi.h>
#include <windows.h>
#include <windows.ui.composition.interop.h>
#include <winrt/Microsoft.UI.Composition.SystemBackdrops.h>
#include <winrt/Microsoft.UI.Input.h>
#include <winrt/Microsoft.UI.Interop.h>
#include <winrt/Microsoft.UI.Windowing.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Graphics.h>
#include <winrt/Windows.System.h>
#include <winrt/Windows.UI.Composition.Desktop.h>
#include <winrt/Windows.UI.Composition.h>

#include <array>
#include <cstdio>
#include <memory>
#include <string>
using namespace winrt;
using namespace Windows::UI::Composition;
using namespace Microsoft::UI::Composition::SystemBackdrops;
struct Backdrop {
  bool opaque = true;
  CompositionColorBrush fallback{nullptr};
  Windows::System::DispatcherQueueController queue{nullptr};
  Compositor compositor{nullptr};
  Desktop::DesktopWindowTarget target{nullptr};
  DesktopAcrylicController acrylic{nullptr};
  SystemBackdropConfiguration configuration{nullptr};
};
static Backdrop* state = nullptr;
static void trace(const char* stage, HRESULT hr) {
  char message[256];
  snprintf(message, sizeof(message), "ZJU window backdrop: %s: 0x%08lx\n",
           stage, (unsigned long)hr);
  OutputDebugStringA(message);
  fputs(message, stderr);
}
// WinRT registration is embedded in the executable by the build script.
static HMODULE runtime = nullptr;
static HRESULT initialize_runtime() {
  HMODULE module = nullptr;
  if (!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS |
                              GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                          reinterpret_cast<LPCWSTR>(&initialize_runtime),
                          &module))
    return HRESULT_FROM_WIN32(GetLastError());
  wchar_t path[32768];
  auto length = GetModuleFileNameW(module, path, 32768);
  if (!length || length >= 32768)
    return HRESULT_FROM_WIN32(ERROR_INSUFFICIENT_BUFFER);
  std::wstring directory(path, length);
  directory.resize(directory.find_last_of(L"\\") + 1);
  // WinRT factories load their implementation DLLs by name. Include the
  // private runtime directory in the safe process-wide DLL search path.
  if (!SetDefaultDllDirectories(LOAD_LIBRARY_SEARCH_DEFAULT_DIRS))
    return HRESULT_FROM_WIN32(GetLastError());
  if (!AddDllDirectory(directory.c_str()))
    return HRESULT_FROM_WIN32(GetLastError());
  // SDK-supported app-local redirection; initialized internally, never
  // configured by users.
  if (!SetEnvironmentVariableW(L"MICROSOFT_WINDOWSAPPRUNTIME_BASE_DIRECTORY",
                               directory.c_str()))
    return HRESULT_FROM_WIN32(GetLastError());
  runtime = LoadLibraryExW(
      (directory + L"Microsoft.WindowsAppRuntime.dll").c_str(), nullptr,
      LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_DEFAULT_DIRS);
  if (!runtime) return HRESULT_FROM_WIN32(GetLastError());
  auto ensure = reinterpret_cast<HRESULT(WINAPI*)()>(
      GetProcAddress(runtime, "WindowsAppRuntime_EnsureIsLoaded"));
  return ensure ? ensure() : HRESULT_FROM_WIN32(GetLastError());
}
// Enable the host backdrop on Windows 10; draw it inside the composition
// target instead of applying Acrylic to the entire HWND, including resize
// borders.
static bool set_legacy_backdrop(HWND hwnd, bool enabled) {
  struct AccentPolicy {
    int state;
    int flags;
    DWORD color;
    int animation;
  };
  struct AttributeData {
    int attribute;
    void* data;
    SIZE_T size;
  };
  using SetAttribute = BOOL(WINAPI*)(HWND, AttributeData*);
  auto set = reinterpret_cast<SetAttribute>(GetProcAddress(
      GetModuleHandleW(L"user32.dll"), "SetWindowCompositionAttribute"));
  if (!set) return false;
  AccentPolicy policy{enabled ? 5 : 0, 0, 0, 0};
  AttributeData data{19, &policy, sizeof(policy)};
  return set(hwnd, &data) != FALSE;
}
extern "C" __declspec(dllexport) void __cdecl acrylic_frame(HWND hwnd,
                                                            int top) noexcept {
  // The Windows 10 composition target supplies the background. Extending
  // the DWM frame over it paints an opaque strip.
  MARGINS margins{0, 0, state && state->fallback ? 0 : top, 0};
  DwmExtendFrameIntoClientArea(hwnd, &margins);
}
extern "C" __declspec(dllexport) HRESULT __cdecl acrylic_theme(
    HWND hwnd, BOOL dark) noexcept {
  try {
    if (!state) return E_UNEXPECTED;
    state->configuration.Theme(dark ? SystemBackdropTheme::Dark
                                    : SystemBackdropTheme::Light);
    auto color = dark ? Windows::UI::Color{255, 32, 32, 32}
                      : Windows::UI::Color{255, 245, 245, 243};
    if (state->opaque)
      color = dark ? Windows::UI::Color{255, 25, 25, 25}
                   : Windows::UI::Color{255, 255, 255, 255};
    state->acrylic.TintColor(color);
    state->acrylic.TintOpacity(state->opaque ? 1.0f : 0.95f);
    state->acrylic.LuminosityOpacity(state->opaque ? 1.0f : 0.7f);
    state->acrylic.FallbackColor(color);
    if (state->fallback) {
      bool blurred = set_legacy_backdrop(hwnd, !state->opaque);
      auto tint = color;
      if (!state->opaque && blurred) tint.A = 210;
      state->fallback.Color(tint);
      trace("legacy acrylic", blurred ? S_OK : E_FAIL);
    }
    auto titlebar = Microsoft::UI::Windowing::AppWindow::GetFromWindowId(
                        Microsoft::UI::GetWindowIdFromWindow(hwnd))
                        .TitleBar();
    titlebar.ButtonForegroundColor(dark ? Windows::UI::Color{255, 228, 228, 223}
                                        : Windows::UI::Color{255, 41, 41, 41});
    auto background = state->opaque ? color : Windows::UI::Color{0, 0, 0, 0};
    // Windows 10 needs an explicit caption base color even with extended
    // content; a transparent base leaves a white strip behind the Acrylic.
    if (state->fallback) {
      titlebar.BackgroundColor(color);
      titlebar.InactiveBackgroundColor(color);
    }
    titlebar.ButtonBackgroundColor(background);
    titlebar.ButtonInactiveBackgroundColor(background);
    trace("theme", S_OK);
    return S_OK;
  } catch (...) {
    auto hr = to_hresult();
    trace("theme failed", hr);
    return hr;
  }
}
extern "C" __declspec(dllexport) HRESULT __cdecl acrylic_init(
    HWND hwnd) noexcept {
  const char* stage = "app-local runtime";
  try {
    if (state) return S_OK;
    check_hresult(initialize_runtime());
    trace(stage, S_OK);
    auto s = std::make_unique<Backdrop>();
    stage = "dispatcher";
    if (!Windows::System::DispatcherQueue::GetForCurrentThread()) {
      DispatcherQueueOptions options{sizeof(DispatcherQueueOptions),
                                     DQTYPE_THREAD_CURRENT, DQTAT_COM_STA};
      check_hresult(CreateDispatcherQueueController(
          options,
          reinterpret_cast<ABI::Windows::System::IDispatcherQueueController**>(
              put_abi(s->queue))));
    }
    stage = "compositor";
    s->compositor = Compositor();
    auto interop = s->compositor.as<
        ABI::Windows::UI::Composition::Desktop::ICompositorDesktopInterop>();
    check_hresult(interop->CreateDesktopWindowTarget(
        hwnd, false,
        reinterpret_cast<
            ABI::Windows::UI::Composition::Desktop::IDesktopWindowTarget**>(
            put_abi(s->target))));
    s->target.Root(s->compositor.CreateContainerVisual());
    stage = "controller";
    if (!DesktopAcrylicController::IsSupported())
      throw hresult_error(E_NOTIMPL);
    s->acrylic = DesktopAcrylicController();
    s->configuration = SystemBackdropConfiguration();
    s->configuration.IsInputActive(true);
    s->acrylic.SetSystemBackdropConfiguration(s->configuration);
    // These optional DWM attributes are Windows 11-only.
    BOOL enable = TRUE;
    auto hostBackdrop = DwmSetWindowAttribute(hwnd, DWMWA_USE_HOSTBACKDROPBRUSH,
                                              &enable, sizeof(enable));
    trace("host backdrop attribute", hostBackdrop);
    if (hostBackdrop != E_INVALIDARG) check_hresult(hostBackdrop);
    DWORD none = 1;
    auto systemBackdrop = DwmSetWindowAttribute(hwnd, DWMWA_SYSTEMBACKDROP_TYPE,
                                                &none, sizeof(none));
    trace("system backdrop attribute", systemBackdrop);
    if (systemBackdrop != E_INVALIDARG) check_hresult(systemBackdrop);
    stage = "SetTarget";
    if (!s->acrylic.SetTarget(Microsoft::UI::GetWindowIdFromWindow(hwnd),
                              s->target)) {
      // Keep Windows 10 blur inside the client area, leaving native resize
      // borders transparent. The tint also supplies the opaque login
      // background.
      trace("legacy backdrop", S_OK);
      s->fallback = s->compositor.CreateColorBrush(
          Windows::UI::Color{255, 255, 255, 255});
      auto visual = s->compositor.CreateSpriteVisual();
      visual.RelativeSizeAdjustment({1.0f, 1.0f});
      visual.Brush(s->fallback);
      auto root = s->compositor.CreateContainerVisual();
      root.RelativeSizeAdjustment({1.0f, 1.0f});
      auto backdrop = s->compositor.CreateSpriteVisual();
      backdrop.RelativeSizeAdjustment({1.0f, 1.0f});
      backdrop.Brush(s->compositor.CreateHostBackdropBrush());
      root.Children().InsertAtTop(backdrop);
      root.Children().InsertAtTop(visual);
      s->target.Root(root);
    }
    stage = "titlebar";
    auto appWindow = Microsoft::UI::Windowing::AppWindow::GetFromWindowId(
        Microsoft::UI::GetWindowIdFromWindow(hwnd));
    auto titlebar = appWindow.TitleBar();
    titlebar.ExtendsContentIntoTitleBar(true);
    // Tauri already handles drag regions; leave frontend controls interactive.
    titlebar.SetDragRectangles(
        std::array<Windows::Graphics::RectInt32, 1>{{{100, 0, 1, 1}}});
    titlebar.ButtonBackgroundColor(Windows::UI::Color{0, 0, 0, 0});
    titlebar.ButtonInactiveBackgroundColor(Windows::UI::Color{0, 0, 0, 0});
    trace("window style",
          static_cast<HRESULT>(GetWindowLongPtrW(hwnd, GWL_STYLE)));
    DWMNCRENDERINGPOLICY policy = DWMNCRP_ENABLED;
    trace("nc policy", DwmSetWindowAttribute(hwnd, DWMWA_NCRENDERING_POLICY,
                                             &policy, sizeof(policy)));
    state = s.release();
    trace(stage, S_OK);
    return acrylic_theme(hwnd, FALSE);
  } catch (...) {
    auto hr = to_hresult();
    trace(stage, hr);
    return hr;
  }
}
extern "C" __declspec(dllexport) void __cdecl acrylic_active(
    BOOL active) noexcept {
  try {
    if (state) state->configuration.IsInputActive(active != FALSE);
  } catch (...) {
  }
}
extern "C" __declspec(dllexport) void __cdecl acrylic_close() noexcept {
  try {
    if (state) {
      state->acrylic.Close();
      delete state;
      state = nullptr;
    }
  } catch (...) {
  }
}

extern "C" __declspec(dllexport) void __cdecl acrylic_layout(
    HWND hwnd, int left, int width, int height, BOOL opaque,
    unsigned color) noexcept {
  try {
    auto id = Microsoft::UI::GetWindowIdFromWindow(hwnd);
    auto titlebar =
        Microsoft::UI::Windowing::AppWindow::GetFromWindowId(id).TitleBar();
    titlebar.SetDragRectangles(std::array<Windows::Graphics::RectInt32, 1>{
        {{left, 0, width, height}}});
    if (state) {
      state->opaque = opaque != FALSE;
      acrylic_theme(hwnd,
                    state->configuration.Theme() == SystemBackdropTheme::Dark);
    }
  } catch (...) {
    trace("layout failed", to_hresult());
  }
}
