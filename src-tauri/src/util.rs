use image::{ColorType, GenericImageView, ImageFormat};
use log::info;
use miniz_oxide::deflate::{compress_to_vec_zlib, CompressionLevel};
use num_bigint::BigUint;
use pdf_writer::{Content, Filter, Finish, Name, Pdf, Rect, Ref};
use reqwest::Client;
use serde_json::Value;
use std::{io::Write, path::Path, time::Instant};

// reference:
// https://github.com/typst/pdf-writer/blob/main/examples/image.rs
pub fn images_to_pdf(
    image_paths: Vec<String>,
    pdf_path: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut pdf = Pdf::new();

    let mut page_ids = Vec::new();
    let mut image_ids = Vec::new();
    let mut s_mask_ids = Vec::new();
    let mut content_ids = Vec::new();

    let catalog_id = Ref::new(1);
    let page_tree_id = Ref::new(2);

    for (index, path) in image_paths.iter().enumerate() {
        page_ids.push(Ref::new((index + 1) as i32 * 4 + 1));
        image_ids.push(Ref::new((index + 1) as i32 * 4 + 2));
        s_mask_ids.push(Ref::new((index + 1) as i32 * 4 + 3));
        content_ids.push(Ref::new((index + 1) as i32 * 4 + 4));

        let image_path = Path::new(path);
        let data = std::fs::read(image_path).unwrap();
        let format = image::guess_format(&data).map_err(|e| e.to_string())?;
        let dynamic = image::load_from_memory(&data).map_err(|e| e.to_string())?;

        let (filter, encoded, mask) = match format {
            ImageFormat::Jpeg => {
                assert!(dynamic.color() == ColorType::Rgb8);
                (Filter::DctDecode, data, None)
            }
            ImageFormat::Png => {
                let level = CompressionLevel::DefaultLevel as u8;
                let encoded = compress_to_vec_zlib(dynamic.to_rgb8().as_raw(), level);
                let mask = dynamic.color().has_alpha().then(|| {
                    let alphas: Vec<_> = dynamic.pixels().map(|p| (p.2).0[3]).collect();
                    compress_to_vec_zlib(&alphas, level)
                });
                (Filter::FlateDecode, encoded, mask)
            }
            _ => Err("unsupported image format")?,
        };

        let width = dynamic.width() as f32;
        let height = dynamic.height() as f32;
        let rect = Rect::new(0.0, 0.0, width, height);

        let mut page = pdf.page(page_ids[index]);
        page.media_box(rect);
        page.parent(page_tree_id);
        page.contents(content_ids[index]);
        let image_name = Name(image_path.file_stem().unwrap().to_str().unwrap().as_bytes());
        page.resources()
            .x_objects()
            .pair(image_name, image_ids[index]);
        page.finish();

        let mut image = pdf.image_xobject(image_ids[index], &encoded);
        image.filter(filter);
        image.width(dynamic.width() as i32);
        image.height(dynamic.height() as i32);
        image.color_space().device_rgb();
        image.bits_per_component(8);
        if mask.is_some() {
            image.s_mask(s_mask_ids[index]);
        }
        image.finish();

        if let Some(encoded) = &mask {
            let mut s_mask = pdf.image_xobject(s_mask_ids[index], encoded);
            s_mask.filter(filter);
            s_mask.width(dynamic.width() as i32);
            s_mask.height(dynamic.height() as i32);
            s_mask.color_space().device_gray();
            s_mask.bits_per_component(8);
            s_mask.finish();
        }

        let w = dynamic.width() as f32;
        let h = dynamic.height() as f32;

        let mut content = Content::new();
        content.save_state();
        content.transform([w, 0.0, 0.0, h, 0.0, 0.0]);
        content.x_object(image_name);
        content.restore_state();
        pdf.stream(content_ids[index], &content.finish());
    }

    pdf.catalog(catalog_id).pages(page_tree_id);
    let page_num = page_ids.len() as i32;
    pdf.pages(page_tree_id).kids(page_ids).count(page_num);

    std::fs::write(pdf_path, pdf.finish())?;

    Ok(())
}

pub fn rsa_no_padding(src: &str, modulus: &str, exponent: &str) -> String {
    let m = BigUint::parse_bytes(modulus.as_bytes(), 16).unwrap();
    let e = BigUint::parse_bytes(exponent.as_bytes(), 16).unwrap();

    let input_nr = BigUint::from_bytes_be(src.as_bytes());

    let crypt_nr = input_nr.modpow(&e, &m);

    crypt_nr
        .to_bytes_be()
        .iter()
        .map(|byte| format!("{:02x}", byte))
        .collect()
}

pub async fn measure_latency(client: Client, url: &str) -> Result<u128, reqwest::Error> {
    let start = Instant::now();
    info!("GET {}", url);
    client.get(url).send().await?;
    Ok(start.elapsed().as_millis())
}

pub fn export_todo_ics(
    todo_list: Vec<Value>,
    ics_path: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let todo_list = todo_list
        .iter()
        .filter(|todo| !todo["end_time"].is_null())
        .map(|todo| todo.clone())
        .collect::<Vec<_>>();

    let mut ics_file = std::fs::File::create(ics_path)?;

    // write ics head
    writeln!(ics_file, "BEGIN:VCALENDAR")?;
    writeln!(ics_file, "VERSION:2.0")?;
    writeln!(ics_file, "PRODID:-//Learning in ZJU//EN")?;

    for todo in todo_list.iter() {
        let end_time = todo["end_time"]
            .as_str()
            .unwrap_or("1970-01-01T00:00:00Z")
            .replace("-", "")
            .replace(":", "");
        let course_name = todo["course_name"].as_str().unwrap();
        let title = todo["title"].as_str().unwrap();
        let url = format!(
            "https://courses.zju.edu.cn/course/{}/learning-activity#/{}?view=scores",
            todo["course_id"].as_i64().unwrap(),
            todo["id"].as_i64().unwrap()
        );

        writeln!(ics_file, "BEGIN:VEVENT")?;
        writeln!(ics_file, "DTSTART:{}", end_time)?;
        writeln!(ics_file, "DTEND:{}", end_time)?;
        writeln!(ics_file, "SUMMARY:{}", title)?;

        writeln!(ics_file, "DESCRIPTION:{}", course_name)?;
        writeln!(ics_file, "URL:{}", url)?;
        writeln!(ics_file, "END:VEVENT")?;
    }

    // write ics tail
    writeln!(ics_file, "END:VCALENDAR")?;

    Ok(())
}
