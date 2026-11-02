import { CheckOutlined } from '@ant-design/icons';

/** Keep the mark mounted so both selection and deselection can animate. */
export default function SelectionCheck({ selected }: { selected: boolean }) {
  return <span className={`selection-check${selected ? ' is-selected' : ''}`} aria-hidden="true"><CheckOutlined /></span>;
}
