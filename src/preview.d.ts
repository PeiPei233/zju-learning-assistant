import type { Upload } from './model';
declare global {
  interface Window {
    __ZJU_PREVIEW_DATA__?: { courses: { id: number; name: string; semester_id: number; academic_year_id: number }[]; uploads: Upload[] };
  }
}
