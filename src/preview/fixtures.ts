import dayjs from 'dayjs';
import { Config, Upload, Subject } from '../model';

export const courses = ['计算机网络', '计算机体系结构', 'Java 应用技术与企业级分布式系统开发实践（2026 年秋冬学期）', '概率论与数理统计', '数据结构与算法设计：复杂问题求解及工程实践专题', '人工智能导论'].map((name, index) => ({
  id: index + 1, name, semester_id: index < 4 ? 1 : 2, academic_year_id: 1,
  instructors: index === 5 ? [] : (index === 2 ? ['张老师', '李老师', '王老师'] : [['张老师', '李老师', '王老师'][index % 3]]).map(name => ({ name })),
}));
const courseFiles = [
  ['第 01 章 · 计算机网络课程导论与互联网体系结构——协议分层、端到端通信及典型应用案例（2026 秋冬学期修订版，含课后习题与补充阅读）.pdf', '实验报告模板.docx', '第 02 章 · 核心概念.pptx'],
  ['性能测试数据.xlsx', '实验指导与参考资料.zip', '课堂录音.mp3'],
  ['实验演示——Spring Boot 微服务项目从环境配置到部署上线的完整操作记录（含常见错误排查与调试过程）.mp4', '程序运行截图.png', '实验环境照片.jpg'],
  ['统计样本.csv', '课程笔记.md', '课堂字幕.srt'],
  ['示例代码.py', '课程资源.7z', '数据结构讲义.DOC'],
  ['课程介绍.PPT', '训练数据.XLS', 'DeepLearning_Transformer_Attention_Architecture_Training_Checkpoint_Epoch_100_Validation_Results_2026_Autumn_Final.bin'],
];
export const uploads: Upload[] = courses.flatMap((course, courseIndex) => courseFiles[courseIndex].map((file_name, index) => ({
  course_id: course.id, id: course.id * 10 + index, reference_id: course.id * 10 + index, course_name: course.name, file_name,
  path: `/preview/course-${course.id}/${file_name}`, size: (index + 1) * 1024 * 1024 + course.id * 1024 * 320,
  activity_id: null, allow_private_wps_office_view: false,
})));
export const subjects: Subject[] = courses.flatMap(course => [0, 1].map(index => ({
  course_id: course.id, sub_id: course.id * 100 + index, course_name: course.name,
  sub_name: `${dayjs().startOf('week').add(index + 1, 'day').format('YYYY-MM-DD')} 09:50${course.id === 3 && index === 0 ? ' · 专题研讨：企业级分布式系统的服务治理、故障恢复与性能优化实践（第一讲及课堂答疑）' : ''}`, lecturer_name: ['张老师', '李老师', '王老师'][course.id % 3],
  path: `/preview/classroom/${course.id}-${index}`, ppt_image_urls: Array.from({ length: 24 + index * 12 }, (_, page) => `preview-slide-${page}`),
})));
// Search results include repeated courses across teachers/terms, as on the real service.
export const classroomCourses: Subject[] = [
  ['高级数据结构与算法分析', '陈越', '2026-2027秋冬'],
  ['数据结构基础', '陈越', '2025-2026春夏'],
  ['高级数据结构与算法分析', '陈越', '2025-2026秋冬'],
  ['数据结构基础（本）', '陈越', '2024-2025春,2024-2025夏'],
  ['高级数据结构与算法分析（本）', '陈越', '2024-2025秋,2024-2025冬'],
  ['数据结构基础', '张老师', '2026-2027秋冬'],
  ['数据结构与算法设计：复杂问题求解及工程实践专题', '李老师', '2026-2027秋冬'],
  ['数据结构与算法分析（英文授课）', '王老师', '2025-2026春夏'],
  ['计算机网络', '张老师', '2026-2027秋冬'],
  ['计算机网络', '李老师', '2025-2026秋冬'],
].map(([course_name, lecturer_name, sub_name], index) => ({
  course_id: 100 + index, sub_id: (100 + index) * 100, course_name, lecturer_name, sub_name,
  path: `/preview/classroom/search/${index}`, ppt_image_urls: [],
}));
export const classroomSubjects: Subject[] = classroomCourses.flatMap(course => [0, 1, 2].map(index => ({
  ...course, sub_id: course.course_id * 100 + index,
  sub_name: `${dayjs().startOf('week').add(index + 1, 'day').format('YYYY-MM-DD')} ${index === 1 ? '13:30' : '09:50'}`,
  path: `${course.path}/${index}`, ppt_image_urls: Array.from({ length: 18 + index * 13 + course.course_id % 7 }, (_, page) => `preview-slide-${page}`),
})));
export const scores = courses.map((course, index) => ({ course_id: `2026-2027-1-${course.id.toString().padStart(5, '0')}`, course_name: course.name, grade: String(85 + index * 2), credits: String(index % 2 ? 2 : 3), grade_point: (4 + index / 10).toFixed(1), makeup_grade: '' }));
export function makePreviewScores(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    ...scores[index % scores.length],
    grade: index === 2 ? '免修' : scores[index % scores.length].grade,
    grade_point: index % 3 === 2 ? '' : scores[index % scores.length].grade_point,
    course_id: `${2026 - Math.floor(index / 30)}-${2027 - Math.floor(index / 30)}-1-${String(index + 1).padStart(5, '0')}`,
    course_name: (index === 2 ? '研究生学术英语能力提升' : index % 3 === 2 ? '高级算法分析' : courses[index % courses.length].name) + (index >= courses.length ? `（专题 ${Math.floor(index / courses.length) + 1}）` : ''),
  }));
}
export const defaultConfig = new Config({
  save_path: '/preview/Downloads/ZJU Learning Assistant', to_pdf: true, auto_download: false,
  excluded_upload_extensions: ['mp4', 'mp3'], ding_url: '', auto_open_download_list: false, auto_select_all_courseware: true, tray: true, max_concurrent_tasks: 3,
  auto_start: false, download_subtitle: true, subtitle_language: ['zh'], subtitle_format: 'srt', subtitle_with_timestamps: true,
  llm_enabled: false, llm_api_base: 'https://example.invalid/v1', llm_api_key: '', llm_model: 'preview-model', llm_temperature: 0.7,
  llm_prompt: '请总结课程内容。', llm_hide_think_tag: true
});

export function makePreviewTodos(): import('../model').TodoItem[] {
  const titles = ['第三次作业：传输层协议与拥塞控制', '实验报告：流水线处理器设计与性能分析', '小组项目阶段汇报：从接口设计到端到端联调的工程实践', '课堂测验：条件概率与贝叶斯公式', '课程论文：从经典算法到大规模系统的设计取舍与实践', '课程学习反馈'];
  return titles.map((title, index) => ({
    id: index + 1, course_id: courses[index].id, course_name: courses[index].name, title,
    end_time: index === 5 ? null : dayjs().add([0, 1, 4, 0, 14][index], 'day').endOf('day').toISOString(),
  }));
}
