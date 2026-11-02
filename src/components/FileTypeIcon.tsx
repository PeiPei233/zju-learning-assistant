import { FileOutlined, FilePdfOutlined, FileWordOutlined, FilePptOutlined, FileExcelOutlined, FileZipOutlined, FileImageOutlined, FileTextOutlined, VideoCameraOutlined, AudioOutlined, CodeOutlined } from '@ant-design/icons';

/** One extension map for resources and downloads; monochrome icons inherit the theme. */
export default function FileTypeIcon({ name, extension, className }: { name: string; extension?: string; className?: string }) {
  const ext = (extension ?? name.trim().match(/\.([^.\\/]+)$/)?.[1] ?? '').toLowerCase();
  const Icon = ext === 'pdf' ? FilePdfOutlined
    : ['doc', 'docx', 'odt', 'rtf'].includes(ext) ? FileWordOutlined
      : ['ppt', 'pptx', 'odp'].includes(ext) ? FilePptOutlined
        : ['xls', 'xlsx', 'xlsm', 'csv', 'ods'].includes(ext) ? FileExcelOutlined
          : ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'].includes(ext) ? FileZipOutlined
            : ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'bmp', 'heic'].includes(ext) ? FileImageOutlined
              : ['mp4', 'mkv', 'mov', 'avi', 'webm', 'm4v'].includes(ext) ? VideoCameraOutlined
                : ['mp3', 'wav', 'm4a', 'flac', 'aac', 'ogg'].includes(ext) ? AudioOutlined
                  : ['txt', 'md', 'srt', 'vtt', 'log'].includes(ext) ? FileTextOutlined
                    : ['py', 'js', 'ts', 'tsx', 'jsx', 'java', 'c', 'cpp', 'h', 'html', 'css', 'json', 'ipynb'].includes(ext) ? CodeOutlined
                      : FileOutlined;
  return <Icon className={className} aria-hidden="true" />;
}
