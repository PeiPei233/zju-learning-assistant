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

    constructor(config?: Config) {
        if (config) {
            this.save_path = config.save_path
            this.to_pdf = config.to_pdf
            this.auto_download = config.auto_download
            this.ding_url = config.ding_url
            this.auto_open_download_list = config.auto_open_download_list
            this.tray = config.tray
        }
    }

    clone(): Config {
        let config = new Config()
        config.save_path = this.save_path
        config.to_pdf = this.to_pdf
        config.auto_download = this.auto_download
        config.ding_url = this.ding_url
        config.auto_open_download_list = this.auto_open_download_list
        config.tray = this.tray
        return config
    }
}