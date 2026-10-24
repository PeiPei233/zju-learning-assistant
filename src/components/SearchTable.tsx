import SelectionActions from './SelectionActions';
import { toggleSelection } from '../utils';
import ActionButton from './ActionButton';
import SelectionCheck from './SelectionCheck';
import OverflowText from './OverflowText';
import React, { useState, useRef, useLayoutEffect } from 'react'
import { Table, Input, InputRef } from 'antd';
import type { ColumnType, TableProps } from 'antd/es/table';
import { SearchOutlined } from '@ant-design/icons';
import Highlighter from 'react-highlight-words';

interface SearchTableProps<T> extends TableProps<T> {
  interactionDisabled?: boolean;
  selectionStatus?: React.ReactNode;
  emptyContent?: React.ReactNode | ((clearFilters: () => void, filtered: boolean) => React.ReactNode);
  fixedBody?: boolean;
  onResultsChange?: (count: number, filtered: boolean) => void;
  columns: (ColumnType<T> & { searchable?: boolean })[];
}

const SearchTable = <T extends object>({
  columns,
  interactionDisabled = false,
  selectionStatus,
  emptyContent,
  fixedBody = false,
  onResultsChange,
  dataSource,
  loading,
  pagination,
  scroll,
  size,
  bordered,
  footer,
  title,
  rowSelection,
  rowKey,
  style,
  onChange,
  ...rest
}: SearchTableProps<T>) => {
  const host = useRef<HTMLDivElement | null>(null);
  const [bodyHeight, setBodyHeight] = useState(240);
  const searchInput = useRef<InputRef>(null)
  const [, refreshView] = useState(0);
  const viewFilters = useRef<Record<string, (React.Key | boolean)[] | null>>({});
  const viewSort = useRef<any>(null);
  // Derive the visible order from fresh data, including after an automatic refresh.
  const getVisibleRows = () => {
    const rows = (dataSource || []).filter(record => Object.entries(viewFilters.current).every(([key, values]) => {
      const column = new_columns.find(col => String(col.key ?? col.dataIndex) === key);
      return !values?.length || !column?.onFilter || values.some(value => column.onFilter!(value, record));
    }));
    const sorts = [viewSort.current].flat().filter(Boolean);
    return [...rows].sort((a, b) => {
      for (const sort of sorts) {
        const comparator = typeof sort.column?.sorter === 'function' ? sort.column.sorter : sort.column?.sorter?.compare;
        if (!sort.order || !comparator) continue;
        const result = comparator(a, b, sort.order);
        if (result) return sort.order === 'descend' ? -result : result;
      }
      return 0;
    });
  };
  const anchor = useRef<React.Key | null>(null)
  const getKey = (record: T): React.Key => typeof rowKey === 'function' ? rowKey(record) : (record as any)[rowKey || 'key'];
  const selected = rowSelection?.selectedRowKeys || [];
  const changeSelection = (keys: React.Key[]) => rowSelection?.onChange?.(keys, (dataSource || []).filter(row => keys.includes(getKey(row))), { type: 'multiple' });
  const toggleRow = (record: T, shift: boolean) => {
    const key = getKey(record);
    changeSelection(toggleSelection(selected, getVisibleRows().map(getKey), key, anchor.current, shift));
    anchor.current = key;
  };

  const getColumnSearchProps = (dataIndex: string, title: React.ReactNode, filterKey: string): ColumnType<T> => ({
    filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters }) => (
      <div className="table-filter-panel" onKeyDown={event => event.stopPropagation()}>
        <Input ref={searchInput} aria-label={`筛选${title}`} placeholder={`筛选${title}`}
          value={selectedKeys[0]} onChange={event => setSelectedKeys(event.target.value ? [event.target.value] : [])}
          onPressEnter={() => confirm()} />
        <div className="table-filter-actions">
          <ActionButton disabled={!selectedKeys.length} onClick={() => {
            clearFilters?.({ confirm: true, closeDropdown: true });
          }}>重置</ActionButton>
          <ActionButton variant="primary" onClick={() => confirm()}>应用</ActionButton>
        </div>
      </div>
    ),
    filterIcon: (filtered: boolean) => <SearchOutlined style={{ color: filtered ? 'var(--status-accent)' : undefined }} />,
    onFilter: (value, record) => {
      const val = record[dataIndex as keyof T];
      return val ? val.toString().toLowerCase().includes((value as string).toLowerCase()) : false;
    },
    filterDropdownProps: {
      onOpenChange: (visible) => {
        if (visible) setTimeout(() => searchInput.current?.select(), 100);
      }
    },
    render: (text) => <OverflowText text={text == null ? '' : String(text)}>
      {viewFilters.current[filterKey]?.length ? (
        <Highlighter
          highlightClassName="search-match"
          searchWords={(viewFilters.current[filterKey] ?? []).map(String)}
          autoEscape
          textToHighlight={text ? text.toString() : ''}
        />
      ) : (
        text
      )}
    </OverflowText>,
  });

  const new_columns = columns.map((col) => {
    if (col.searchable != null && !col.searchable) {
      return col
    } else {
      return {
        ...col,
        ...getColumnSearchProps(col.dataIndex as string, typeof col.title === 'function' ? col.title({}) : col.title, String(col.key ?? col.dataIndex)),
        filteredValue: viewFilters.current[String(col.key ?? col.dataIndex)] ?? null,
        ...(col.render ? { render: col.render } : {}),
      }
    }
  })

  if (rowSelection) new_columns.push({ key: 'selection-indicator', width: 36, render: (_, record) => <SelectionCheck selected={selected.includes(getKey(record))} /> });

  const visibleRows = getVisibleRows();
  const hasFilters = Object.values(viewFilters.current).some(values => !!values?.length);
  useLayoutEffect(() => { onResultsChange?.(visibleRows.length, hasFilters); }, [visibleRows.length, hasFilters, onResultsChange]);
  const clearAllFilters = () => {
    viewFilters.current = {};
    refreshView(value => value + 1);
  };

  useLayoutEffect(() => {
    if (!fixedBody || !host.current) return;
    const element = host.current;
    const toolbar = element.querySelector<HTMLElement>('.selection-toolbar');
    const header = element.querySelector<HTMLElement>('.ant-table-header');
    const measure = () => {
      const toolbarHeight = toolbar ? toolbar.getBoundingClientRect().height + parseFloat(getComputedStyle(toolbar).marginBottom || '0') : 0;
      setBodyHeight(Math.max(0, Math.floor(element.clientHeight - toolbarHeight - (header?.getBoundingClientRect().height || 0) - 1)));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (toolbar) observer.observe(toolbar);
    if (header) observer.observe(header);
    measure();
    return () => observer.disconnect();
  }, [fixedBody]);

  return <div className="selection-table" ref={element => { host.current = element; if (element) element.inert = interactionDisabled; }}>
    {rowSelection && <div className="selection-toolbar"><div className="selection-status">{selectionStatus ?? <span>点击行选择 · Shift 连选</span>}</div>
      <SelectionActions className="selection-actions" selectedKeys={selected} visibleKeys={visibleRows.map(getKey)} onChange={changeSelection} disabled={interactionDisabled} />
    </div>}
    <Table<T>
      {...rest}
      onChange={(pagination, filters, sorter, extra) => { viewFilters.current = filters; viewSort.current = sorter; refreshView(value => value + 1); onChange?.(pagination, filters, sorter, extra); }}
      rowClassName={record => rowSelection && selected.includes(getKey(record)) ? 'selected-row' : ''}
      onRow={record => rowSelection ? {
        tabIndex: 0, 'aria-selected': selected.includes(getKey(record)),
        onClick: event => { if (!(event.target as HTMLElement).closest('button,a,input')) toggleRow(record, event.shiftKey); },
        onKeyDown: event => { if (event.target === event.currentTarget && (event.key === ' ' || event.key === 'Enter')) { event.preventDefault(); toggleRow(record, event.shiftKey); } },
      } : {}}
      rowKey={rowKey}
      columns={new_columns as ColumnType<T>[]}
      dataSource={dataSource}
      loading={loading}
      pagination={pagination}
      scroll={fixedBody ? { x: 640, y: bodyHeight } : scroll}
      size={size}
      bordered={bordered}
      footer={footer}
      title={title}
      style={style}
    />
    {!visibleRows.length && emptyContent && <div className="table-empty-region">{typeof emptyContent === 'function' ? emptyContent(clearAllFilters, hasFilters) : emptyContent}</div>}
  </div>
}

export default SearchTable
