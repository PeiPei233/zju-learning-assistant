import PanelHeading from '../../components/PanelHeading';
import { useConfig } from '../../context/ConfigContext';
import type { ScoreItem } from '../../model';
import { calculateAverageGrade, calculateScoreTotals, scoreDisplayCredits } from '../../utils';
import EmptyState from '../../components/EmptyState';
import FetchState from '../../components/FetchState';
import ActionButton from '../../components/ActionButton';
import Workspace from '../../components/Workspace';
import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { ReloadOutlined, FileSearchOutlined, SearchOutlined } from '@ant-design/icons';
import SearchTable from '../../components/SearchTable'
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import { ColumnType } from 'antd/es/table';

dayjs.locale('zh-cn')




interface ScoreProps {
  configError?: string | null;
  lastSync: string | null;
  totalGp: number;
  totalCredit: number;
  loading: boolean;
  score: ScoreItem[];
  handleSync: () => void;
}

export default function Score({
  configError,
  lastSync,
  totalGp,
  totalCredit,
  loading,
  score,
  handleSync
}: ScoreProps) {


  const { savedConfig: config } = useConfig();
  const [results, setResults] = useState({ count: score.length, filtered: false });
  const handleResultsChange = useCallback((count: number, filtered: boolean) => setResults({ count, filtered }), []);
  const [selectedCourseIds, setSelectedCourseIds] = useState<React.Key[]>([])
  const selectedRows = useMemo(() => score.filter(row => selectedCourseIds.includes(row.course_id)), [score, selectedCourseIds]);
  const selectedKeys = selectedRows.map(row => row.course_id);
  const { gp: selectedTotalGp, credit: selectedTotalCredit } = useMemo(() => calculateScoreTotals(selectedRows), [selectedRows]);

  const averageGrade = useMemo(() => calculateAverageGrade(score), [score]);
  const selectedAverageGrade = useMemo(() => calculateAverageGrade(selectedRows), [selectedRows]);

  useEffect(() => {
    const currentKeys = new Set(score.map(row => row.course_id));
    setSelectedCourseIds(previous => {
      const retained = previous.filter(key => currentKeys.has(String(key)));
      return retained.length === previous.length ? previous : retained;
    });
  }, [score]);

  const columns: (ColumnType<ScoreItem> & { searchable?: boolean })[] = [
    {
      title: '选课课号',
      dataIndex: 'course_id',
      width: '28%',
      sorter: (a, b) => a.course_id.localeCompare(b.course_id),
    },
    {
      title: '课程名称',
      dataIndex: 'course_name',
      sorter: (a, b) => a.course_name.localeCompare(b.course_name),
    },
    {
      title: '成绩',
      dataIndex: 'grade',
      width: 65,
      searchable: false,
      sorter: (a, b) => {
        const valA = parseFloat(a.grade);
        const valB = parseFloat(b.grade);
        if (isNaN(valA) || isNaN(valB)) {
          return a.grade.localeCompare(b.grade)
        }
        return valA - valB
      }
    },
    {
      title: '学分',
      dataIndex: 'credits',
      width: 65,
      searchable: false,
      sorter: (a, b) => {
        const valA = parseFloat(a.credits);
        const valB = parseFloat(b.credits);
        if (isNaN(valA) || isNaN(valB)) {
          return a.credits.localeCompare(b.credits)
        }
        return valA - valB
      }
    },
    {
      title: '绩点',
      dataIndex: 'grade_point',
      width: 65,
      searchable: false,
      sorter: (a, b) => {
        const valA = parseFloat(a.grade_point);
        const valB = parseFloat(b.grade_point);
        if (isNaN(valA) || isNaN(valB)) {
          return a.grade_point.localeCompare(b.grade_point)
        }
        return valA - valB
      }
    },
    {
      title: '补考成绩',
      dataIndex: 'makeup_grade',
      width: 80,
      searchable: false
    },
  ]

  return <Workspace headerless title="成绩" panel={<>
    <PanelHeading><h2>成绩查询</h2></PanelHeading>
    <div className="panel-controls score-panel-controls">
      <div className="score-summary"><span>平均绩点</span><strong>{(totalCredit ? totalGp / totalCredit : 0).toFixed(2)}</strong><span>平均成绩</span><strong>{averageGrade.toFixed(2)}</strong><span>总学分</span><strong>{scoreDisplayCredits(score).toFixed(2)}</strong></div>
    </div>
    <div className="panel-bottom">
      <p>{config.score_auto_sync ? '成绩自动更新，同步与通知可在设置中调整。' : '自动同步已关闭，可点击立即刷新更新成绩。'}</p>
      <p>最后更新 · {lastSync || '尚未更新'}</p>
    </div>
  </>}
    footer={<span>{selectedKeys.length ? `已选 ${selectedKeys.length} 门 · 平均绩点 ${(selectedTotalCredit ? selectedTotalGp / selectedTotalCredit : 0).toFixed(2)} · 平均成绩 ${selectedAverageGrade.toFixed(2)} · 学分 ${scoreDisplayCredits(selectedRows).toFixed(2)}` : `共 ${score.length} 门课程 · 选择课程可计算加权绩点和成绩`}</span>}>
    <div className="score-content">
      <div className="resource-toolbar"><div className="resource-heading"><h2>成绩列表</h2><span>{results.filtered ? `${results.count} / ${score.length}` : score.length}</span></div>
        <div className="resource-toolbar-actions"><ActionButton variant="secondary" aria-busy={loading} disabled={loading} onClick={handleSync}><ReloadOutlined spin={loading} />{loading ? '正在刷新' : '立即刷新'}</ActionButton></div>
      </div>
      <div className="score-table-region" aria-busy={loading}>
        <SearchTable<ScoreItem> onResultsChange={handleResultsChange} fixedBody interactionDisabled={loading} rowSelection={{ selectedRowKeys: selectedKeys, onChange: keys => setSelectedCourseIds(keys) }} columns={columns} dataSource={score} rowKey="course_id"
          selectionStatus={loading && score.length ? <FetchState inline label="正在更新…" /> : undefined}
          pagination={false} tableLayout="fixed" size="middle" loading={false}
          locale={{ emptyText: null }} emptyContent={(clearFilters, filtered) => loading ? <FetchState label="正在获取成绩…" /> : configError ? <EmptyState icon={<FileSearchOutlined />} action={<button className="text-button" onClick={handleSync}>重试读取设置</button>}>读取设置失败：{configError}</EmptyState> : <EmptyState icon={score.length ? <SearchOutlined aria-hidden="true" /> : <FileSearchOutlined aria-hidden="true" />} action={filtered && <button className="text-button" onClick={clearFilters}>清除筛选</button>}>{score.length ? '没有匹配的结果' : '暂无成绩，可点击“立即刷新”重新获取'}</EmptyState>} />
      </div>
    </div>
  </Workspace>
}
