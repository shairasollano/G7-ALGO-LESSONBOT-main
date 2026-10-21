import type { TableColumn, TableRow } from "@shared/contract";

interface TableBlockProps {
  columns: TableColumn[];
  rows: TableRow[];
  caption?: string;
}

export function TableBlock({ columns, rows, caption }: TableBlockProps) {
  return (
    <div className="block table-block">
      {caption && <p className="block-caption">{caption}</p>}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col">{c.header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c.key}>{String(row[c.key] ?? "")}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
