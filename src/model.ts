export class Upload {
    id: number
    reference_id: number
    file_name: string
    course_name: string
    path: string
    size: number
}

export class Progress {
    id: string
    status: string
    file_name: string
    downloaded_size: number
    total_size: number
    msg: string
}

export class Subject {
    course_id: number
    sub_id: number
    course_name: string
    sub_name: string
    lecturer_name: string
    path: string
    ppt_image_urls: string[]
}

export class Config {
    save_path: string
    to_pdf: boolean
    auto_download: boolean
    ding_url: string
    auto_open_download_list: boolean
    tray: boolean
    max_concurrent_tasks: number
    auto_start: boolean
    download_subtitle: boolean
    subtitle_language: string[]
    subtitle_format: string
    subtitle_with_timestamps: boolean

    llm_enabled: boolean
    llm_api_base: string
    llm_api_key: string
    llm_model: string
    llm_temperature: number
    llm_prompt: string
    llm_hide_think_tag: boolean

    constructor(config?: Partial<Config>) {
        Object.assign(this, config);
    }

    clone(): Config {
        return new Config({ ...this });
    }
}