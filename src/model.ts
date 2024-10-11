export class Upload {
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

    constructor(config?: Partial<Config>) {
        Object.assign(this, config);
    }

    clone(): Config {
        return new Config({ ...this });
    }
}