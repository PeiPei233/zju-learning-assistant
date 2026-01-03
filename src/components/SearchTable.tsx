import React, { useState, useRef } from 'react'
import { Button, Table, Input, Space, InputRef } from 'antd';
import type { ColumnType, TableProps } from 'antd/es/table';
import type { FilterConfirmProps } from 'antd/es/table/interface';
import { SearchOutlined } from '@ant-design/icons';
// @ts-ignore
import Highlighter from 'react-highlight-words';

interface SearchTableProps<T> extends TableProps<T> {
  columns: (ColumnType<T> & { searchable?: boolean })[];
}

const SearchTable = <T extends object>({
  columns,
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
  style
}: SearchTableProps<T>) => {
  const [searchText, setSearchText] = useState('')
  const [searchedColumn, setSearchedColumn] = useState('')
  const searchInput = useRef<InputRef>(null)

  const handleSearch = (
    selectedKeys: string[],
    confirm: (param?: FilterConfirmProps) => void,
    dataIndex: string,
  ) => {
    confirm();
    setSearchText(selectedKeys[0]);
    setSearchedColumn(dataIndex);
  };

  const handleReset = (clearFilters: () => void) => {
    clearFilters();
    setSearchText('');
  };

  const getColumnSearchProps = (dataIndex: string, title: React.ReactNode): ColumnType<T> => ({
    filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters, close }) => (
      <div
        style={{
          padding: 8,
        }}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <Input
          ref={searchInput}
          placeholder={`搜索 ${title}`}
          value={selectedKeys[0]}
          onChange={(e) => setSelectedKeys(e.target.value ? [e.target.value] : [])}
          onPressEnter={() => handleSearch(selectedKeys as string[], confirm, dataIndex)}
          style={{
            marginBottom: 8,
            display: 'block',
            width: 250,
          }}
        />
        <Space>
          <Button
            type="primary"
            onClick={() => handleSearch(selectedKeys as string[], confirm, dataIndex)}
            icon={<SearchOutlined />}
            size="small"
            style={{
              width: 70,
            }}
          >
            搜索
          </Button>
          <Button
            onClick={() => clearFilters && handleReset(clearFilters)}
            size="small"
            style={{
              width: 70,
            }}
          >
            重置
          </Button>
          <Button
            type="link"
            size="small"
            onClick={() => {
              confirm({
                closeDropdown: false,
              });
              setSearchText((selectedKeys as string[])[0]);
              setSearchedColumn(dataIndex);
            }}
          >
            筛选
          </Button>
          <Button
            type="link"
            size="small"
            onClick={() => {
              close();
            }}
          >
            取消
          </Button>
        </Space>
      </div>
    ),
    filterIcon: (filtered: boolean) => (
      <SearchOutlined
        style={{
          color: filtered ? '#1677ff' : undefined,
        }}
      />
    ),
    onFilter: (value, record) => {
      const val = record[dataIndex as keyof T];
      return val ? val.toString().toLowerCase().includes((value as string).toLowerCase()) : false;
    },
    onFilterDropdownOpenChange: (visible) => {
      if (visible) {
        setTimeout(() => searchInput.current?.select(), 100);
      }
    },
    render: (text) =>
      searchedColumn === dataIndex ? (
        <Highlighter
          highlightStyle={{
            backgroundColor: '#ffc069',
            padding: 0,
          }}
          searchWords={[searchText]}
          autoEscape
          textToHighlight={text ? text.toString() : ''}
        />
      ) : (
        text
      ),
  });

  const new_columns = columns.map((col) => {
    if (col.searchable != null && !col.searchable) {
      return col
    } else {
      return {
        ...col,
        ...getColumnSearchProps(col.dataIndex as string, col.title),
      }
    }
  })

  return <Table<T>
    rowSelection={rowSelection}
    rowKey={rowKey}
    columns={new_columns as ColumnType<T>[]}
    dataSource={dataSource}
    loading={loading}
    pagination={pagination}
    scroll={scroll}
    size={size}
    bordered={bordered}
    footer={footer}
    title={title}
    style={style}
  />
}

export default SearchTable