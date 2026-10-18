import { invoke } from "./bridge"
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
  errorMessage: string
  msg: string

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
    this.errorMessage = ''
    this.msg = ''
  }

  public async start(): Promise<any> {
    this.startTime = Date.now()
    this.lastUpdateTime = this.startTime
    this.downloadedSize = 0
    this.progress = 0
    this.speed = 0
    this.remainingTime = 0
    this.status = 'downloading'
    this.errorMessage = ''
    this.msg = ''
  }

  public updateProgress(progress: Progress): void {
    this.status = progress.status
    this.totalSize = progress.downloaded_size > progress.total_size ? 0 : progress.total_size
    this.name = progress.file_name
    this.msg = progress.msg || ''
    const currentTime = Date.now()
    if (this.status === 'done') {
      this.progress = 1
      this.speed = 0
      this.remainingTime = 0
      return
    }
    // Always refresh quantities, including transitions to an unknown total.
    // Throttle speed estimation only, never the visible percentage.
    this.progress = this.totalSize > 0 ? Math.min(1, Math.max(0, progress.downloaded_size / this.totalSize)) : 0
    if (this.totalSize <= 0) {
      this.remainingTime = 0
    }
    if (currentTime - this.lastUpdateTime < 1000) {
      return
    }
    this.speed = Math.max(0, (progress.downloaded_size - this.downloadedSize) / (currentTime - this.lastUpdateTime) * 1000)
    this.lastUpdateTime = currentTime
    this.downloadedSize = progress.downloaded_size
    const elapsed = currentTime - this.startTime
    const avgSpeed = elapsed > 0 ? this.downloadedSize / elapsed : 0
    this.remainingTime = avgSpeed > 0 ? Math.max(0, this.totalSize - this.downloadedSize) / avgSpeed / 1000 : 0
  }

  public async cancel(): Promise<any> {
    this.status = 'canceled'
    this.msg = ''
  }

  public getDescription(): string {
    if (this.msg) {
      return this.msg
    }
    if (this.status === 'pending') {
      return '等待中'
    } else if (this.status === 'downloading') {
      return bytesToSize(this.downloadedSize) + '/' + (this.totalSize > 0 ? bytesToSize(this.totalSize) : '-') + ' | ' + bytesToSize(this.speed) + '/s' +
        (this.remainingTime && !isNaN(this.remainingTime) && isFinite(this.remainingTime) ? ' 剩余 ' + formatTime(this.remainingTime) : '')
    } else if (this.status === 'done') {
      return '下载完成'
    } else if (this.status === 'failed') {
      return this.errorMessage || '下载失败'
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

  async cancel(): Promise<any> {
    super.cancel()
    // cancel uploading
    return invoke('cancel_download', { id: this.id })
  }

  async openFile(folder: boolean): Promise<string> {
    // Keep the original file name for retries.
    return invoke('open_file_upload', { upload: { ...this.upload, file_name: this.name }, folder })
  }

  public equals(task: Task): boolean {
    if (task instanceof LearningTask) {
      return this.id === task.id && this.upload.file_name === task.upload.file_name && this.path === task.path &&
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
    if (this.msg) {
      return this.msg
    }
    if (this.status === 'downloading') {
      return 'PPTs: ' + this.downloadedSize + '/' + this.totalSize +
        (this.remainingTime && !isNaN(this.remainingTime) && isFinite(this.remainingTime) ? ' | 预计剩余 ' + formatTime(this.remainingTime) : '')
    } else if (this.status === 'writing') {
      return '正在写入 PDF 文件'
    } else {
      return super.getDescription()
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
  _maxConcurrentTasks: number
  queue: Task[]
  downloading: Task[]
  tasks: Task[]
  private readonly runs = new WeakMap<Task, object>()

  constructor() {
    this._maxConcurrentTasks = 3
    this.queue = []
    this.downloading = []
    this.tasks = []
  }

  get maxConcurrentTasks(): number {
    return this._maxConcurrentTasks
  }

  set maxConcurrentTasks(value: number) {
    if (value <= 0) {
      throw new Error('maxConcurrentTasks must be greater than 0')
    }
    this._maxConcurrentTasks = value
    this._adjustQueue()
  }

  _adjustQueue(): void {
    while (this.downloading.length < this._maxConcurrentTasks) {
      const next = this.queue.shift()
      if (!next) {
        break
      }
      const task = next
      this.downloading.push(task)
      const run = {}
      this.runs.set(task, run)
      task.start().catch(err => {
        if (this.runs.get(task) !== run) return
        console.log(err)
        task.status = 'failed'
        task.msg = ''
        task.errorMessage = err.toString()
        const index = this.downloading.findIndex(item => item.id === task.id)
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
      const task = this.downloading[index]
      const previousStatus = task.status
      const run = this.runs.get(task)
      task.cancel().then(() => {
        if (this.runs.get(task) !== run) return
        const currentIndex = this.downloading.indexOf(task)
        if (currentIndex !== -1) this.downloading.splice(currentIndex, 1)
        this._adjustQueue()
      }).catch(error => {
        // A rejected cancel must not free a slot still occupied by the backend.
        if (this.runs.get(task) === run && this.downloading.includes(task) && task.status === 'canceled') {
          task.status = previousStatus
          task.msg = String(error)
        }
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
      if (['done', 'failed', 'canceled'].includes(progress.status)) {
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
    const index = this.tasks.findIndex(item => item.id === task.id)
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
    const index = this.tasks.findIndex(item => item.id === id)
    if (index !== -1) {
      return this.tasks[index].openFile(folder)
    }
    return '下载任务不存在'
  }
}