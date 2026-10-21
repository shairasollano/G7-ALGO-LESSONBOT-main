import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceLine,
} from "recharts";
import type { ChartData } from "@shared/contract";

interface ChartBlockProps {
  chartType: "line" | "bar";
  data: ChartData;
  caption: string;
}

const BAR_COLORS = ["#4f46e5", "#0891b2", "#059669", "#d97706", "#dc2626", "#7c3aed", "#db2777", "#65a30d"];

export function ChartBlock({ data, caption }: ChartBlockProps) {
  const chartData = data.data.map((d) => ({ ...d }));

  return (
    <div className="block chart-block">
      {caption && <p className="block-caption">{caption}</p>}
      <div className="chart-viewport" role="img" aria-label={`Chart. ${caption}`}>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData} margin={{ top: 8, right: 12, bottom: 24, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11 }}
              interval={0}
              angle={chartData.length > 4 ? -25 : 0}
              textAnchor={chartData.length > 4 ? "end" : "middle"}
              height={chartData.length > 4 ? 50 : 30}
            />
            <YAxis tick={{ fontSize: 11 }} width={36} />
            <Tooltip
              formatter={(value: number, _name: string, item) => [
                `${value} ${data.valueUnit}`,
                (item?.payload as { description?: string })?.description ?? data.valueUnit,
              ]}
            />
            <Bar dataKey="value" name={data.valueUnit} radius={[4, 4, 0, 0]}>
              {chartData.map((entry, i) => (
                <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {/* Accessible table equivalent of the chart data. */}
      <table className="chart-table">
        <caption className="sr-only">{caption} — data table</caption>
        <thead>
          <tr>
            <th scope="col">Label</th>
            <th scope="col">{data.valueUnit}</th>
          </tr>
        </thead>
        <tbody>
          {data.data.map((d, i) => (
            <tr key={i}>
              <td>{d.label}</td>
              <td>{d.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
