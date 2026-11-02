fn main() {
    println!("cargo:rerun-if-changed=native/windows/acrylic.cpp");
    println!("cargo:rerun-if-changed=native/windows/build.ps1");
    println!("cargo:rerun-if-changed=native/windows/app-manifest-fragment.xml");
    let mut attributes = tauri_build::Attributes::new();
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let arch = match std::env::var("CARGO_CFG_TARGET_ARCH").unwrap().as_str() {
            "x86_64" => "x64",
            "x86" => "x86",
            "aarch64" => "arm64",
            other => panic!("Unsupported Windows architecture: {other}"),
        };
        let root = std::path::PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").unwrap());
        let output = root.join("resources/windows-runtime");
        let status = std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
            .arg(root.join("native/windows/build.ps1"))
            .arg("-Output")
            .arg(&output)
            .arg("-Architecture")
            .arg(arch)
            .status()
            .expect("Start Windows runtime build");
        assert!(status.success(), "Windows runtime build failed");
        // Cargo dev launches are outside an installer: deploy the same payload beside the executable.
        let out_dir = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
        let profile_dir = out_dir.ancestors().nth(3).expect("Cargo profile directory");
        copy_runtime(&output, profile_dir);
        let sdk_manifest =
            std::fs::read_to_string(output.join("runtime.manifest")).expect("WinRT manifest");
        let windows_manifest = sdk_manifest.replace(
            "</assembly>",
            &format!(
                "{}\n</assembly>",
                include_str!("native/windows/app-manifest-fragment.xml")
            ),
        );
        attributes = attributes.windows_attributes(
            tauri_build::WindowsAttributes::new().app_manifest(windows_manifest),
        );
    }
    tauri_build::try_build(attributes).expect("Tauri build configuration")
}

fn copy_runtime(source: &std::path::Path, destination: &std::path::Path) {
    std::fs::create_dir_all(destination).expect("Create runtime directory");
    for entry in std::fs::read_dir(source).expect("Read runtime payload") {
        let entry = entry.unwrap();
        let target = destination.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_runtime(&entry.path(), &target);
        } else {
            let bytes = std::fs::read(entry.path()).unwrap();
            if std::fs::read(&target).ok().as_deref() != Some(bytes.as_slice()) {
                std::fs::write(target, bytes)
                    .expect("Deploy runtime file (close running preview before rebuilding)");
            }
        }
    }
}
