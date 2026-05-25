use std::{
    fs,
    path::{Path, PathBuf},
};

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![quit_app, export_json_file])
        .setup(|app| {
            #[cfg(desktop)]
            {
                use tauri_plugin_autostart::MacosLauncher;

                app.handle().plugin(tauri_plugin_autostart::init(
                    MacosLauncher::LaunchAgent,
                    Some(vec![]),
                ))?;
                create_tray(app)?;
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running LifeMonitor");
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn export_json_file(app: tauri::AppHandle, file_name: String, content: String) -> Result<String, String> {
    let safe_name = sanitize_file_name(&file_name)?;
    let output_dir = app
        .path()
        .download_dir()
        .map_err(|error| format!("无法找到系统下载目录：{error}"))?;
    fs::create_dir_all(&output_dir).map_err(|error| format!("创建导出目录失败：{error}"))?;

    let output_path = unique_file_path(&output_dir, &safe_name);
    fs::write(&output_path, content).map_err(|error| format!("写入导出文件失败：{error}"))?;

    Ok(output_path.to_string_lossy().into_owned())
}

fn sanitize_file_name(file_name: &str) -> Result<String, String> {
    let trimmed = file_name.trim();
    if trimmed.is_empty() {
        return Err("导出文件名不能为空。".to_string());
    }

    let sanitized: String = trimmed
        .chars()
        .map(|character| match character {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            character if character.is_control() => '_',
            character => character,
        })
        .collect();

    if sanitized == "." || sanitized == ".." {
        return Err("导出文件名无效。".to_string());
    }

    Ok(sanitized)
}

fn unique_file_path(output_dir: &Path, file_name: &str) -> PathBuf {
    let initial = output_dir.join(file_name);
    if !initial.exists() {
        return initial;
    }

    let path = Path::new(file_name);
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("lifemonitor");
    let extension = path.extension().and_then(|value| value.to_str());

    for index in 1.. {
        let candidate_name = match extension {
            Some(extension) => format!("{stem} ({index}).{extension}"),
            None => format!("{stem} ({index})"),
        };
        let candidate = output_dir.join(candidate_name);
        if !candidate.exists() {
            return candidate;
        }
    }

    unreachable!("unique file search should always return");
}

#[cfg(desktop)]
fn create_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "显示 LifeMonitor", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    let mut builder = TrayIconBuilder::new()
        .tooltip("LifeMonitor")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(app)?;
    Ok(())
}

#[cfg(desktop)]
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}
