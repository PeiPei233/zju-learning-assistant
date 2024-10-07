import { invoke } from "@tauri-apps/api/core"
import { bytesToSize, formatTime } from "./utils"
import { Progress, Subject, Upload } from "./model"

export class Task {
    id: string
    name: string
    path: string
    totalSize: number
    downloadedSize: number
    status: string
    progress: number
    speed: number
    startTime: number
    lastUpdateTime: number
    remainingTime: number

    constructor() {
        this.id = ''
        this.name = ''
        this.path = ''
        this.totalSize = 0
        this.downloadedSize = 0
        this.status = 'pending'
        this.progress = 0
        this.speed = 0
        this.startTime = 0
        this.lastUpdateTime = 0
        this.remainingTime = 0
    }

    public async start(): Promise<any> {
        this.startTime = Date.now()
        this.lastUpdateTime = this.startTime
        this.downloadedSize = 0
        this.progress = 0
        this.speed = 0
        this.remainingTime = 0
        this.status = 'downloading'
    }

    public updateProgress(progress: Progress): void {
        this.status = progress.status
        this.totalSize = progress.total_size
        this.name = progress.file_name
        let currentTime = Date.now()
        if (this.status === 'done') {
            this.progress = 1
            this.speed = 0
            this.remainingTime = 0
            return
        }
        if (currentTime - this.lastUpdateTime < 1000) {
            return
        }
        this.speed = (progress.downloaded_size - this.downloadedSize) / (currentTime - this.lastUpdateTime) * 1000
        this.lastUpdateTime = currentTime
        let avgSpeed = this.downloadedSize / (this.lastUpdateTime - this.startTime)
        this.remainingTime = (this.totalSize - this.downloadedSize) / avgSpeed / 1000
        this.downloadedSize = progress.downloaded_size
        this.progress = this.downloadedSize / this.totalSize
    }

    public async cancel(): Promise<any> {
        this.status = 'canceled'
    }

    public getDescription(): string {
        if (this.status === 'pending') {
            return '等待中'
        } else if (this.status === 'downloading') {
            return bytesToSize(this.downloadedSize) + '/' + bytesToSize(this.totalSize) + ' | ' + bytesToSize(this.speed) + '/s' +
                (this.remainingTime && !isNaN(this.remainingTime) && isFinite(this.remainingTime) ? ' 剩余 ' + formatTime(this.remainingTime) : '')
        } else if (this.status === 'done') {
            return '下载完成'
        } else if (this.status === 'failed') {
            return '下载失败'
        } else if (this.status === 'canceled') {
            return '已取消'
        } else {
            return '未知状态'
        }
    }

    public async openFile(folder: boolean): Promise<string> {
        return invoke('open_file', { path: this.path, folder })
    }

    public equals(task: Task): boolean {
        return this.id === task.id && this.name === task.name && this.path === task.path
    }

}

export class LearningTask extends Task {
    upload: Upload
    syncUpload: boolean

    constructor(upload: Upload, syncUpload: boolean = false) {
        super()
        this.id = `${upload.reference_id}-${upload.path}`
        this.name = upload.file_name
        this.path = upload.path
        this.upload = upload
        this.syncUpload = syncUpload
        this.totalSize = upload.size
    }

    async start(): Promise<any> {
        super.start()
        // start uploading
        return invoke('start_download_upload', { id: this.id, upload: this.upload, syncUpload: this.syncUpload })
    }

    public updateProgress(progress: Progress): void {
        super.updateProgress(progress)
        this.upload.file_name = progress.file_name
    }

    async cancel(): Promise<any> {
        super.cancel()
        // cancel uploading
        return invoke('cancel_download', { id: this.id })
    }

    async openFile(folder: boolean): Promise<string> {
        return invoke('open_file_upload', { upload: this.upload, folder })
    }

    public equals(task: Task): boolean {
        if (task instanceof LearningTask) {
            return this.id === task.id && this.name === task.name && this.path === task.path &&
                this.upload.size === task.upload.size
        } else {
            return false
        }
    }
}

export class ClassroomTask extends Task {
    subject: Subject
    toPdf: boolean

    constructor(subject: Subject, toPdf: boolean = true) {
        super()
        this.id = `${subject.course_id}-${subject.sub_id}-${subject.path}`
        this.name = `${subject.course_name}-${subject.sub_name}`
        this.path = subject.path
        this.subject = subject
        this.toPdf = toPdf
        this.totalSize = subject.ppt_image_urls.length
    }

    async start(): Promise<any> {
        super.start()
        // start downloading
        return invoke('start_download_ppts', { id: this.id, subject: this.subject, toPdf: this.toPdf })
    }

    async cancel(): Promise<any> {
        super.cancel()
        // cancel downloading
        return invoke('cancel_download', { id: this.id })
    }


    public getDescription(): string {
        if (this.status === 'pending') {
            return '等待中'
        } else if (this.status === 'downloading') {
            return 'PPTs: ' + this.downloadedSize + '/' + this.totalSize +
                (this.remainingTime && !isNaN(this.remainingTime) && isFinite(this.remainingTime) ? ' | 预计剩余 ' + formatTime(this.remainingTime) : '')
        } else if (this.status === 'done') {
            return '下载完成'
        } else if (this.status === 'failed') {
            return '下载失败'
        } else if (this.status === 'canceled') {
            return '已取消'
        } else if (this.status === 'writing') {
            return '正在写入 PDF 文件'
        } else {
            return '未知状态'
        }
    }

    async openFile(folder: boolean): Promise<string> {
        return invoke('open_file_ppts', { subject: this.subject, folder })
    }

    public equals(task: Task): boolean {
        if (task instanceof ClassroomTask) {
            return this.id === task.id && this.name === task.name && this.path === task.path &&
                this.subject.ppt_image_urls.length === task.subject.ppt_image_urls.length && this.toPdf === task.toPdf
        } else {
            return false
        }
    }
}

export class DownloadManager {
    MAX_CONCURRENT_DOWNLOADS: number
    queue: Task[]
    downloading: Task[]
    tasks: Task[]

    constructor() {
        this.MAX_CONCURRENT_DOWNLOADS = 3
        this.queue = []
        this.downloading = []
        this.tasks = []
    }

    _adjustQueue(): void {
        while (this.downloading.length < this.MAX_CONCURRENT_DOWNLOADS) {
            let next = this.queue.shift()
            if (!next) {
                break
            }
            let task = next
            this.downloading.push(task)
            task.start().catch(err => {
                console.log(err)
                task.status = 'failed'
                let index = this.downloading.findIndex(item => item.id === task.id)
                if (index !== -1) {
                    this.downloading.splice(index, 1)
                }
                this._adjustQueue()
            })
        }
    }

    addTask(task: Task, reDownload: boolean = false): void {
        // check if task already exists in queue or downloading
        let index = this.downloading.findIndex(item => item.id === task.id)
        if (index !== -1) {
            return
        }
        index = this.queue.findIndex(item => item.id === task.id)
        if (index !== -1) {
            return
        }
        // if task is not in queue or downloading, add it to queue
        index = this.tasks.findIndex(item => item.id === task.id)
        if (index === -1) {
            this.tasks.push(task)
            this.queue.push(task)
        } else {
            if (this.tasks[index].status === 'canceled' || reDownload) {
                this.tasks[index] = task
                this.queue.push(task)
            }
        }
        this._adjustQueue()
    }

    cancelTask(id: string): void {
        let index = this.downloading.findIndex(item => item.id === id)
        if (index !== -1) {
            this.downloading[index].cancel().then(() => {
                this.downloading.splice(index, 1)
            })
        } else {
            index = this.queue.findIndex(item => item.id === id)
            if (index !== -1) {
                this.queue[index].status = 'canceled'
                this.queue.splice(index, 1)
            }
            index = this.tasks.findIndex(item => item.id === id)
            if (index !== -1) {
                this.tasks[index].status = 'canceled'
            }
        }
        this._adjustQueue()
    }

    updateProgress(progress: Progress): void {
        let index = this.tasks.findIndex(item => item.id === progress.id)
        if (index !== -1) {
            this.tasks[index].updateProgress(progress)
            if (progress.status !== 'downloading' && progress.status !== 'start') {
                index = this.downloading.findIndex(item => item.id === progress.id)
                if (index !== -1) {
                    this.downloading.splice(index, 1)
                }
            }
        }
        this._adjustQueue()
    }

    cleanUp(): void {
        this.downloading.forEach(item => {
            item.cancel()
        })
        this.downloading = []
        this.queue = []
        this.tasks = []
    }

    getTasks(): Task[] {
        return this.tasks
    }

    getDownloadingCount(): number {
        return this.downloading.length + this.queue.length
    }

    checkTaskExists(task: Task): boolean {
        let index = this.tasks.findIndex(item => item.id === task.id)
        if (index === -1) {
            return false
        }
        return this.tasks[index].status !== 'canceled' && this.tasks[index].equals(task)
    }

    reDownloadTask(id: string): void {
        let index = this.downloading.findIndex(item => item.id === id)
        if (index !== -1) {
            return
        }
        index = this.queue.findIndex(item => item.id === id)
        if (index !== -1) {
            return
        }
        index = this.tasks.findIndex(item => item.id === id)
        if (index !== -1) {
            this.tasks[index].status = 'pending'
            this.queue.push(this.tasks[index])
        }
        this._adjustQueue()
    }

    cancelAllTasks(): void {
        this.tasks.forEach(item => {
            if (item.status !== 'done') {
                item.cancel()
            }
        })
        this.downloading = []
        this.queue = []
    }

    reDownloadAllTasks(): void {
        this.tasks.forEach(item => {
            if (item.status === 'canceled' || item.status === 'failed') {
                item.status = 'pending'
                this.queue.push(item)
            }
        })
        this._adjustQueue()
    }

    async openTask(id: string, folder: boolean): Promise<string> {
        let index = this.tasks.findIndex(item => item.id === id)
        if (index !== -1) {
            return this.tasks[index].openFile(folder)
        }
        return '下载任务不存在'
    }
}