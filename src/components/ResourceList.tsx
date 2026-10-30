import Highlighter from 'react-highlight-words';
import EmptyState from './EmptyState';
import SelectionActions from './SelectionActions';
import { toggleSelection } from '../utils';
import SelectionCheck from './SelectionCheck';
import FetchState from './FetchState';
import OverflowText from './OverflowText';
import ActionButton from './ActionButton';
import { Input, Select, Tooltip } from 'antd';
import React, { useId, useRef, useState } from 'react';
import { SearchOutlined, FilterOutlined, FileOutlined, CloseOutlined } from '@ant-design/icons';

type Field<T> = { label: string; value: (item: T) => string };
type Sort<T> = { label: string; compare: (a: T, b: T) => number };
export interface ResourceListProps<T> {
  items: T[];
  itemKey: (item: T) => React.Key;
  selectedKeys: React.Key[];
  onSelectionChange: (keys: React.Key[]) => void;
  title: string;
  actions?: React.ReactNode;
  fields: Field<T>[];
  sorts?: Sort<T>[];
  compact?: boolean;
  fieldFilters?: boolean;
  searchPlaceholder?: string;
  loading?: boolean;
  emptyText?: string;
  emptyContent?: React.ReactNode;
  emptyIcon?: React.ReactNode;
  renderItem: (item: T) => { title: string; titleField?: string; subtitle?: { text: string; field: string }[]; icon?: React.ReactNode; meta?: React.ReactNode };
}

/** App-owned list UI. Filtering never discards selection outside the visible results. */
export default function ResourceList<T>({ items, itemKey, selectedKeys, onSelectionChange, title, fields, sorts = [], compact = false, fieldFilters = !compact, searchPlaceholder, loading = false, emptyText = '暂无内容', emptyContent, emptyIcon = <FileOutlined />, renderItem, actions }: ResourceListProps<T>) {
  const [query, setQuery] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersId = useId();
  const descriptionsId = useId();
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sortIndex, setSortIndex] = useState(-1);
  const anchor = useRef<React.Key | null>(null);
  const normalized = query.trim().toLocaleLowerCase();
  const visible = items.filter(item => (!normalized || fields.some(field => (field.value(item) || '').toLocaleLowerCase().includes(normalized))) &&
    fields.every(field => !filters[field.label] || (field.value(item) || '').toLocaleLowerCase().includes(filters[field.label].trim().toLocaleLowerCase())));
  if (sorts[sortIndex]) visible.sort(sorts[sortIndex].compare);
  const highlight = (text: string, field?: string) => {
    const searchWords = [...new Set([query, field ? filters[field] || '' : ''].map(value => value.trim()).filter(Boolean))];
    return searchWords.length
      ? <Highlighter autoEscape searchWords={searchWords} textToHighlight={text} highlightClassName="search-match" /> : text;
  };
  const selected = new Set(selectedKeys);
  const filterCount = Object.values(filters).filter(Boolean).length;
  const toggle = (item: T, shift: boolean) => {
    const key = itemKey(item);
    onSelectionChange(toggleSelection(selectedKeys, visible.map(itemKey), key, anchor.current, shift));
    anchor.current = key;
  };
  return <section className={`resource-list ${compact ? 'resource-list-compact' : ''}`} aria-label={title} aria-busy={loading}>
    <div className="resource-toolbar">
      {!compact && <div className="resource-heading"><h2>{title}</h2><span>{normalized || filterCount ? `${visible.length} / ${items.length}` : items.length}</span></div>}
      <Input disabled={loading} className="resource-search" aria-label={`搜索${title}`} prefix={<SearchOutlined aria-hidden="true" />}
        placeholder={searchPlaceholder ?? (compact ? '搜索课程' : '搜索文件、课程…')} value={query} onChange={e => setQuery(e.target.value)}
        suffix={query ? <Tooltip title="清除搜索" trigger={['hover', 'focus']}><button disabled={loading} className="icon-button" aria-label="清除搜索" onClick={() => setQuery('')}><CloseOutlined /></button></Tooltip> : null} />
      {!compact && sorts.length > 0 && <Select disabled={loading} className="resource-sort" aria-label={`${title}排序`} value={sortIndex}
        onChange={setSortIndex} popupMatchSelectWidth={false}
        options={[{ value: -1, label: '默认顺序' }, ...sorts.map((sort, index) => ({ value: index, label: sort.label }))]} />}
      {fieldFilters && fields.length > 1 && <Tooltip title="按字段筛选" trigger={['hover', 'focus']}><ActionButton disabled={loading} variant="secondary" iconOnly className={`resource-filter-button ${filterCount ? 'is-active' : ''}`} aria-label="按字段筛选" aria-expanded={filtersOpen} aria-controls={filtersId} onClick={() => setFiltersOpen(!filtersOpen)}><FilterOutlined /></ActionButton></Tooltip>}
      {actions && <div className="resource-toolbar-actions">{actions}</div>}
    </div>
    {fieldFilters && fields.length > 1 && <div id={filtersId} className={`resource-filters-motion${filtersOpen ? ' is-open' : ''}`} aria-hidden={!filtersOpen} ref={node => { if (node) node.inert = !filtersOpen || loading; }}>
      <div className="resource-filters-clip"><div className="resource-filters">{fields.map(field => <label key={field.label}>{field.label}<Input disabled={loading} value={filters[field.label] || ''} onChange={e => setFilters({ ...filters, [field.label]: e.target.value })} placeholder={`筛选${field.label}`} /></label>)}<button disabled={loading} className="text-button" onClick={() => setFilters({})}>重置筛选</button></div></div>
    </div>}
    <div className="resource-selection">{loading && visible.length > 0 ? <FetchState inline label={compact ? "正在更新课程" : "正在更新…"} /> : <span>{compact ? `已选 ${selectedKeys.length} 门` : '点击行选择 · Shift 连选'}</span>}
      <SelectionActions selectedKeys={selectedKeys} visibleKeys={visible.map(itemKey)} onChange={onSelectionChange} disabled={loading} label={compact ? '全选' : '全选当前结果'} />
    </div>
    <div className="resource-rows" key={`${query}|${JSON.stringify(filters)}|${sortIndex}`}>
      {loading && !visible.length && <FetchState label={compact ? "正在获取课程…" : `正在获取${title}…`} />}
      {!loading && !visible.length && (emptyContent ?? <EmptyState icon={items.length ? <SearchOutlined aria-hidden="true" /> : emptyIcon} action={(query || filterCount > 0) && <button className="text-button" onClick={() => { setQuery(''); setFilters({}); }}>清除筛选</button>}>{items.length ? '没有匹配的结果' : emptyText}</EmptyState>)}
      {visible.map((item, index) => {
        const content = renderItem(item);
        const checked = selected.has(itemKey(item));
        const subtitle = (content.subtitle ?? []).filter(part => part.text);
        const descriptionId = subtitle.length ? `${descriptionsId}-${index}` : undefined;
        return <button type="button" role="checkbox" aria-checked={checked} aria-label={content.title} aria-describedby={descriptionId} key={itemKey(item)} disabled={loading}
          className={`resource-row ${checked ? 'is-selected' : ''}`} onClick={e => toggle(item, e.shiftKey)}
          onKeyDown={e => { if ((e.key === ' ' || e.key === 'Enter') && e.shiftKey) { e.preventDefault(); toggle(item, true); } }}>
          {!compact && <span className="resource-icon" aria-hidden="true">{content.icon || <FileOutlined />}</span>}
          <span className="resource-copy"><OverflowText className="resource-name" text={content.title}>{highlight(content.title, content.titleField)}</OverflowText>{subtitle.length > 0 && <OverflowText id={descriptionId} className="resource-description" text={subtitle.map(part => part.text).join(' · ')}>{subtitle.map((part, index) => <React.Fragment key={part.field}>{index > 0 && ' · '}{highlight(part.text, part.field)}</React.Fragment>)}</OverflowText>}</span>
          {content.meta && <span className="resource-meta">{content.meta}</span>}
          <span className="resource-check" aria-hidden="true"><SelectionCheck selected={checked} /></span>
        </button>;
      })}
    </div>
  </section>;
}
