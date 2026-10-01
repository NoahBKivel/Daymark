import { createPlugin } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import { DayGridView, DayTable, Table, TableRows } from '@fullcalendar/daygrid/internal';
import { cloneElement, type VNode, type ComponentType } from '@fullcalendar/core/preact';

declare module '@fullcalendar/core/internal' {
  interface BaseOptionRefiners {
    expandedWeekDate: (value: string) => string;
  }
}

// Keep FullCalendar's event placement and hit detection, changing only the
// event limit passed to the row containing the selected date.
function replaceComponent(
  node: VNode<any>,
  from: ComponentType<any>,
  to: ComponentType<any>,
): VNode<any> {
  if (node.type === from) return { ...node, type: to };
  const children = node.props.children;
  if (!children) return node;
  const replace = (child: any): any =>
    Array.isArray(child)
      ? child.map(replace)
      : child && typeof child === 'object' && 'type' in child
        ? replaceComponent(child, from, to)
        : child;
  return cloneElement(node, {}, replace(children));
}

class ExpandableRows extends TableRows {
  render() {
    const node = super.render();
    const renderRows = node.props.children;
    const date = this.context.options.expandedWeekDate;
    return cloneElement(node, {
      children: (...args: any[]) => {
        const rows = renderRows(...args);
        return cloneElement(
          rows,
          {},
          rows.props.children.map((row: VNode<any>) =>
            row.props.cells.some(
              (cell: { date: Date }) => cell.date.toISOString().slice(0, 10) === date,
            )
              ? cloneElement(row, { dayMaxEvents: false })
              : row,
          ),
        );
      },
    });
  }
}
class ExpandableTable extends Table {
  render() {
    return replaceComponent(super.render(), TableRows, ExpandableRows);
  }
}
class ExpandableDayTable extends DayTable {
  render() {
    return replaceComponent(super.render(), Table, ExpandableTable);
  }
}
class ExpandableMonthView extends DayGridView {
  renderSimpleLayout(...args: Parameters<DayGridView['renderSimpleLayout']>) {
    const [header, body] = args;
    return super.renderSimpleLayout(header, (content) =>
      replaceComponent(body(content), DayTable, ExpandableDayTable),
    );
  }
  renderHScrollLayout(...args: Parameters<DayGridView['renderHScrollLayout']>) {
    const [header, body, columns, width] = args;
    return super.renderHScrollLayout(
      header,
      (content) => replaceComponent(body(content), DayTable, ExpandableDayTable),
      columns,
      width,
    );
  }
}
export const expandableMonthPlugin = createPlugin({
  name: 'expandable-month',
  optionRefiners: { expandedWeekDate: String },
  views: {
    dayGridMonth: {
      ...dayGridPlugin.views.dayGridMonth,
      component: ExpandableMonthView,
    },
  },
});
