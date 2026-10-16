import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { test } from 'node:test'

// Run the real task classes with only the Tauri boundary mocked. Node >=22.13.
const source = stripTypeScriptTypes(readFileSync(new URL('../src/downloadManager.ts', import.meta.url), 'utf8'))
  .replace(/^import .*$/gm, '')
  .replace(/export class /g, 'class ')

function harness(invoke = async () => {}) {
  return new Function('invoke', 'bytesToSize', 'formatTime', 'console', `${source}\nreturn { Task, LearningTask, DownloadManager }`)(invoke, String, String, { log() {} })
}

function upload() {
  return { id: 42, reference_id: 7, file_name: 'slides.pptx', course_name: 'course', path: 'downloads/course', size: 10000,
    activity_id: 8, allow_private_wps_office_view: true }
}

function previewProgress(task, status = 'done') {
  return { id: task.id, status, file_name: 'slides.pptx.preview.pdf', downloaded_size: 120, total_size: 120,
    msg: status === 'done' ? '预览版 PDF（非原文件）' : '正在导出预览版 PDF' }
}

test('preview completion opens the exported file and preserves original metadata for retry', async () => {
  const calls = []
  const { LearningTask } = harness(async (command, args) => calls.push({ command, args }))
  const original = upload()
  const task = new LearningTask(original)
  task.updateProgress(previewProgress(task))
  assert.equal(original.file_name, 'slides.pptx')
  assert.equal(task.name, 'slides.pptx.preview.pdf')
  assert.equal(task.downloadedSize, 120)
  assert.equal(task.getDescription(), '预览版 PDF（非原文件）')
  assert.ok(task.equals(new LearningTask(upload())))
  await task.openFile(false)
  assert.equal(calls[0].command, 'open_file_upload')
  assert.equal(calls[0].args.upload.file_name, 'slides.pptx.preview.pdf')
  await task.start()
  assert.equal(calls[1].args.upload.file_name, 'slides.pptx')
  assert.equal(task.msg, '')
})

test('unknown export length does not produce invalid progress values', async () => {
  const { Task } = harness()
  const task = new Task()
  await task.start()
  task.lastUpdateTime -= 2000
  task.updateProgress({ id: '', status: 'downloading', file_name: 'preview.pdf', downloaded_size: 120, total_size: 0 })
  assert.ok(Number.isFinite(task.progress))
  assert.ok(Number.isFinite(task.remainingTime))
})

test('failed export clears the busy message and releases the next queued download', async () => {
  let rejectFirst
  let starts = 0
  const { LearningTask, DownloadManager } = harness(() => {
    starts++
    return starts === 1 ? new Promise((_, reject) => { rejectFirst = reject }) : Promise.resolve()
  })
  const manager = new DownloadManager()
  manager.maxConcurrentTasks = 1
  const first = new LearningTask(upload())
  const second = new LearningTask({ ...upload(), reference_id: 9 })
  manager.addTask(first)
  manager.addTask(second)
  first.updateProgress(previewProgress(first, 'downloading'))
  rejectFirst(new Error('WPS 打印导出失败 (HTTP 403)'))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(first.status, 'failed')
  assert.equal(first.msg, '')
  assert.match(first.getDescription(), /HTTP 403/)
  assert.equal(starts, 2)
  assert.equal(manager.downloading[0], second)
})

test('canceling an export clears its temporary message', async () => {
  const { LearningTask } = harness()
  const task = new LearningTask(upload())
  task.updateProgress(previewProgress(task, 'downloading'))
  await task.cancel()
  assert.equal(task.status, 'canceled')
  assert.equal(task.getDescription(), '已取消')
})
