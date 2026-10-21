//! GTK owns the titlebar, window actions and resize decoration on Linux.
use gtk::atk::prelude::AtkObjectExt;
use gtk::prelude::*;
use std::sync::atomic::{AtomicI32, Ordering};
use std::{
    cell::{Cell, RefCell},
    rc::Rc,
};
use tauri::Emitter;
static HEADER_HEIGHT: AtomicI32 = AtomicI32::new(38);
pub fn height() -> i32 {
    HEADER_HEIGHT.load(Ordering::Relaxed)
}

fn sidebar_tooltip(window: &tauri::WebviewWindow, button: &gtk::Button, visible: bool) {
    let allocation = button.allocation();
    let _ = window.emit(
        "native-sidebar-tooltip",
        serde_json::json!({
            "visible": visible, "x": allocation.x() + allocation.width() / 2,
            "bottom": allocation.y() + allocation.height() - height()
        }),
    );
}

struct Chrome {
    toggle: gtk::Button,
    icon: gtk::DrawingArea,
    collapsed: Rc<Cell<bool>>,
    progress: Rc<Cell<f64>>,
    css: gtk::CssProvider,
    dark: bool,
    navigation: bool,
}
thread_local! {
    static CHROME: RefCell<Option<Chrome>> = const { RefCell::new(None) };
}

pub fn install(window: &tauri::WebviewWindow) -> Result<(), Box<dyn std::error::Error>> {
    let native = window.gtk_window()?;
    native.set_widget_name("zju-window");
    let header = gtk::HeaderBar::new();
    header.set_widget_name("zju-titlebar");
    header.set_show_close_button(true);
    header.set_decoration_layout(Some(":minimize,maximize,close"));
    header.set_has_subtitle(false);
    // Wrap the entire header: an empty custom-title child can receive a zero
    // allocation, leaving no input surface despite hexpand being enabled.
    let drag_area = gtk::EventBox::new();
    drag_area.set_visible_window(true);
    drag_area.set_above_child(false);
    drag_area.set_hexpand(true);
    drag_area.add_events(gtk::gdk::EventMask::BUTTON_PRESS_MASK);
    let native_weak = native.downgrade();
    drag_area.connect_button_press_event(move |_, event| {
        if event.button() != 1 {
            return gtk::glib::Propagation::Proceed;
        }
        let Some(native) = native_weak.upgrade() else {
            return gtk::glib::Propagation::Proceed;
        };
        if event.event_type() == gtk::gdk::EventType::DoubleButtonPress {
            if native.is_maximized() {
                native.unmaximize();
            } else {
                native.maximize();
            }
        } else if event.event_type() == gtk::gdk::EventType::ButtonPress {
            let (x, y) = event.root();
            native.begin_move_drag(1, x as i32, y as i32, event.time());
        }
        gtk::glib::Propagation::Stop
    });
    header.set_custom_title(Some(&gtk::Label::new(None)));
    drag_area.add(&header);
    let toggle = gtk::Button::new();
    toggle.set_widget_name("zju-sidebar-toggle");
    toggle.set_valign(gtk::Align::Center);
    toggle.set_size_request(28, 28);
    let icon = gtk::DrawingArea::new();
    icon.set_size_request(17, 17);
    icon.set_halign(gtk::Align::Center);
    icon.set_valign(gtk::Align::Center);
    let collapsed = Rc::new(Cell::new(false));
    let progress = Rc::new(Cell::new(0.0_f64));
    let icon_state = progress.clone();
    // Same geometry as PanelIcon.tsx, drawn at the native display scale.
    icon.connect_draw(move |area, cr| {
        let color = area.style_context().color(area.state_flags());
        cr.scale(17.0 / 20.0, 17.0 / 20.0);
        cr.set_source_rgba(
            color.red().into(),
            color.green().into(),
            color.blue().into(),
            color.alpha().into(),
        );
        cr.set_line_width(1.4);
        let pi = std::f64::consts::PI;
        cr.new_sub_path();
        cr.arc(15.0, 6.0, 3.0, -pi / 2.0, 0.0);
        cr.arc(15.0, 14.0, 3.0, 0.0, pi / 2.0);
        cr.arc(5.0, 14.0, 3.0, pi / 2.0, pi);
        cr.arc(5.0, 6.0, 3.0, pi, 3.0 * pi / 2.0);
        cr.close_path();
        let _ = cr.stroke();
        let x = 8.0 - 2.0 * icon_state.get();
        cr.move_to(x, 3.0);
        cr.line_to(x, 17.0);
        let _ = cr.stroke();
        if icon_state.get() < 1.0 {
            cr.set_source_rgba(
                color.red().into(),
                color.green().into(),
                color.blue().into(),
                0.45 * (1.0 - icon_state.get()),
            );
            cr.set_line_width(2.0);
            cr.move_to(5.0, 6.0);
            cr.line_to(5.0, 14.0);
            let _ = cr.stroke();
        }
        gtk::glib::Propagation::Stop
    });
    toggle.add(&icon);
    icon.show();
    // Render the app's Antd tooltip in the WebView below the native header.
    toggle.add_events(
        gtk::gdk::EventMask::ENTER_NOTIFY_MASK | gtk::gdk::EventMask::LEAVE_NOTIFY_MASK,
    );
    // Hover and keyboard focus independently keep the tooltip visible.
    let hovered = Rc::new(Cell::new(false));
    let focused = Rc::new(Cell::new(false));
    let target = window.clone();
    let hover = hovered.clone();
    let focus = focused.clone();
    toggle.connect_enter_notify_event(move |button, _| {
        hover.set(true);
        sidebar_tooltip(&target, button, hover.get() || focus.get());
        gtk::glib::Propagation::Proceed
    });
    let target = window.clone();
    let hover = hovered.clone();
    let focus = focused.clone();
    toggle.connect_leave_notify_event(move |button, _| {
        hover.set(false);
        sidebar_tooltip(&target, button, hover.get() || focus.get());
        gtk::glib::Propagation::Proceed
    });
    let target = window.clone();
    let hover = hovered.clone();
    let focus = focused.clone();
    toggle.connect_focus_in_event(move |button, _| {
        focus.set(true);
        sidebar_tooltip(&target, button, hover.get() || focus.get());
        gtk::glib::Propagation::Proceed
    });
    let target = window.clone();
    let hover = hovered.clone();
    let focus = focused.clone();
    toggle.connect_focus_out_event(move |button, _| {
        focus.set(false);
        sidebar_tooltip(&target, button, hover.get() || focus.get());
        gtk::glib::Propagation::Proceed
    });
    toggle.set_no_show_all(true);
    let target = window.clone();
    toggle.connect_clicked(move |_| {
        let _ = target.emit("native-toggle-sidebar", ());
    });
    // Match the 52px web navigation rail: 12px inset + 28px button / 2 = 26px.
    header.pack_start(&toggle);
    let css = gtk::CssProvider::new();
    if let Some(screen) = gtk::prelude::WidgetExt::screen(&native) {
        gtk::StyleContext::add_provider_for_screen(
            &screen,
            &css,
            gtk::STYLE_PROVIDER_PRIORITY_APPLICATION,
        );
    }
    let metrics_target = window.clone();
    header.connect_size_allocate(move |_, allocation| {
        HEADER_HEIGHT.store(allocation.height(), Ordering::Relaxed);
        let _ = metrics_target.emit("native-chrome-height", allocation.height());
    });
    native.set_titlebar(Some(&drag_area));
    native.set_decorated(true);
    drag_area.show_all();
    CHROME.with(|slot| {
        *slot.borrow_mut() = Some(Chrome {
            toggle,
            icon,
            collapsed,
            progress,
            css,
            dark: false,
            navigation: false,
        })
    });
    theme(false);
    Ok(())
}

fn update_style(chrome: &Chrome) {
    let (rail, canvas, foreground, muted, hover) = if chrome.dark {
        (
            "rgba(32,32,32,0.95)",
            "#191919",
            "#e4e4df",
            "#92928c",
            "#2b2b29",
        )
    } else {
        (
            "rgba(234,234,231,0.95)",
            "#ffffff",
            "#292927",
            "#82827b",
            "#efefeb",
        )
    };
    let background = if chrome.navigation { rail } else { canvas };
    let window_background = if chrome.navigation {
        "transparent"
    } else {
        canvas
    };
    let _ = chrome.css.load_from_data(format!(
        "#zju-window {{ background-color: {window_background}; }}
         #zju-titlebar {{ background-image: none; background-color: {background}; color: {foreground}; box-shadow: none; border-bottom: none; min-height: 38px; padding: 0 8px 0 12px; }}
         #zju-titlebar button.titlebutton {{ color: {foreground}; background-image: none; background-color: transparent; border-color: transparent; box-shadow: none; text-shadow: none; }}
         #zju-titlebar button.titlebutton image {{ color: {foreground}; opacity: 1; -gtk-icon-shadow: none; }}
         #zju-titlebar button.titlebutton:hover {{ background-color: {hover}; }}
         #zju-titlebar button.titlebutton:backdrop, #zju-titlebar button.titlebutton:backdrop image {{ color: {muted}; }}
         #zju-sidebar-toggle {{ background-image: none; background-color: transparent; color: {muted}; border: none; box-shadow: none; min-width: 28px; min-height: 28px; padding: 0; margin: 0; border-radius: 5px; }}
         #zju-sidebar-toggle:hover {{ background-color: {hover}; color: {foreground}; }}"
    ).as_bytes());
    chrome.icon.queue_draw();
}

pub fn theme(dark: bool) {
    CHROME.with(|slot| {
        if let Some(chrome) = slot.borrow_mut().as_mut() {
            chrome.dark = dark;
            if let Some(settings) = gtk::Settings::default() {
                settings.set_gtk_application_prefer_dark_theme(dark);
            }
            update_style(chrome);
        }
    });
}

pub fn navigation(visible: bool, collapsed: bool, peek: bool) {
    CHROME.with(|slot| {
        if let Some(chrome) = slot.borrow_mut().as_mut() {
            chrome.navigation = visible;
            let target = if collapsed && !peek { 1.0 } else { 0.0 };
            if chrome.collapsed.replace(collapsed && !peek) != (collapsed && !peek) {
                let progress = chrome.progress.clone();
                let desired = chrome.collapsed.clone();
                let start = progress.get();
                let started = std::time::Instant::now();
                let animate = gtk::Settings::default()
                    .map(|s| s.is_gtk_enable_animations())
                    .unwrap_or(true);
                if animate && visible {
                    chrome.icon.add_tick_callback(move |icon, _| {
                        if desired.get() != (target == 1.0) {
                            return gtk::glib::ControlFlow::Break;
                        }
                        let t = (started.elapsed().as_secs_f64() / 0.22).min(1.0);
                        progress.set(start + (target - start) * (1.0 - (1.0 - t).powi(3)));
                        icon.queue_draw();
                        if t >= 1.0 {
                            gtk::glib::ControlFlow::Break
                        } else {
                            gtk::glib::ControlFlow::Continue
                        }
                    });
                } else {
                    progress.set(target);
                }
            }
            if let Some(accessible) = chrome.toggle.accessible() {
                accessible.set_name(if collapsed {
                    "展开侧栏"
                } else {
                    "收起侧栏"
                });
                accessible.set_description(if collapsed && !peek {
                    "侧栏已折叠"
                } else {
                    "侧栏已展开"
                });
            }
            chrome.toggle.set_visible(visible);
            update_style(chrome);
        }
    });
}
