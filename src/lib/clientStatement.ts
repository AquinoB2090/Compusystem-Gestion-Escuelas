// Cálculo puro del estado de cuenta de clientes individuales.
// No depende de jsPDF ni del navegador para poder probarlo por separado.

export type ReportType = 'desde_ultimo_abono' | 'completo' | 'rango';

export type StatementMovement = {
  id: number;
  fecha: string;
  descripcion: string;
  cantidad: number;
  unidad: 'fotocopias' | 'quetzales';
  creado_en?: string | null;
};

export type StatementPayment = {
  id: number;
  fecha: string;
  descripcion: string;
  monto: number;
  creado_en?: string | null;
};

export type StatementReportOptions = {
  movements: StatementMovement[];
  payments: StatementPayment[];
  reportType?: ReportType;
  from?: string | null;
  to?: string | null;
  generatedAt?: Date;
};

export type StatementRow = {
  key: string;
  fecha: string;
  fechaLabel: string;
  descripcion: string;
  tipoLabel: string;
  detail: string;
  amount: number;
  amountLabel: string;
  saldo: number;
  saldoLabel: string;
  isOpening: boolean;
};

export type StatementReport = {
  reportType: ReportType;
  rows: StatementRow[];
  saldoAnterior: number;
  totalConsumos: number;
  totalPagos: number;
  saldoPendiente: number;
  copies: number;
  shownCount: number;
  canceled: boolean;
  lastAbono: { fecha: string; fechaLabel: string } | null;
  rangeFrom: string | null;
  rangeTo: string | null;
  generatedAt: Date;
  filename: string;
};

type StatementEvent = {
  key: string;
  kind: 'consumo' | 'abono';
  id: number;
  fecha: string;
  descripcion: string;
  amount: number;
  detail: string;
  copies: number;
  createdAt: string;
};

const copiesPerQuetzal = 4;

export const REPORT_TYPES: Array<{ value: ReportType; label: string }> = [
  { value: 'desde_ultimo_abono', label: 'Desde el último abono' },
  { value: 'completo', label: 'Completo (todo el historial)' },
  { value: 'rango', label: 'Por rango de fechas' },
];

export const reportTypeLabel = (value: ReportType) =>
  REPORT_TYPES.find((item) => item.value === value)?.label ?? value;

const round2 = (value: number) => {
  const number = Number(value) || 0;
  return Math.round((number + (number >= 0 ? 1 : -1) * Number.EPSILON) * 100) / 100;
};

export const formatMoney = (amount: number) => {
  const value = Number.isFinite(Number(amount)) ? Math.abs(Number(amount)) : 0;
  return `Q ${value.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

// jsPDF con fuentes estándar no puede representar el signo menos tipográfico
// (U+2212): usar el guion ASCII garantiza que se vea igual en todos los PDF.
export const formatSignedMoney = (amount: number) =>
  `${Number(amount) < 0 ? '- ' : ''}${formatMoney(amount)}`;

export const formatDate = (value: string | null | undefined) => {
  const iso = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
};

export const isISODate = (value: string | null | undefined) => {
  const iso = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [year, month, day] = iso.split('-').map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
};

export const validateStatementOptions = ({
  reportType = 'desde_ultimo_abono',
  from,
  to,
}: Pick<StatementReportOptions, 'reportType' | 'from' | 'to'>) => {
  if (!['desde_ultimo_abono', 'completo', 'rango'].includes(reportType)) {
    return 'Tipo de reporte inválido.';
  }
  if (reportType !== 'rango') return null;
  if (!isISODate(from) || !isISODate(to)) {
    return 'Selecciona la fecha de inicio y la fecha de fin.';
  }
  const fromISO = String(from).slice(0, 10);
  const toISO = String(to).slice(0, 10);
  if (fromISO > toISO) return 'La fecha de inicio no puede ser posterior a la fecha de fin.';
  return null;
};

export const reportFilename = (reportType: ReportType, generatedAt = new Date()) => {
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp = `${generatedAt.getFullYear()}-${pad(generatedAt.getMonth() + 1)}-${pad(generatedAt.getDate())}_${pad(generatedAt.getHours())}${pad(generatedAt.getMinutes())}`;
  return `${stamp}_${reportType}.pdf`;
};

export const reportTitle = (reportType: ReportType, from?: string | null, to?: string | null) => {
  if (reportType === 'completo') return 'Estado de cuenta completo';
  if (reportType === 'rango') return `Estado de cuenta del ${formatDate(from)} al ${formatDate(to)}`;
  return 'Estado de cuenta desde el último abono';
};

export const reportPeriodLabel = ({
  reportType,
  lastAbono,
  from,
  to,
}: {
  reportType: ReportType;
  lastAbono: { fecha: string } | null;
  from?: string | null;
  to?: string | null;
}) => {
  if (reportType === 'completo') return 'Todo el historial registrado';
  if (reportType === 'rango') return `Del ${formatDate(from)} al ${formatDate(to)}`;
  if (lastAbono) return `Desde el último abono del ${formatDate(lastAbono.fecha)}`;
  return 'Todos los movimientos registrados';
};

const normalizeDate = (value: string | null | undefined) => String(value || '').slice(0, 10);

const normalizeCreatedAt = (value: string | null | undefined) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
};

const compareEvents = (a: StatementEvent, b: StatementEvent) => {
  if (a.fecha !== b.fecha) return a.fecha < b.fecha ? -1 : 1;
  if (a.createdAt && b.createdAt && a.createdAt !== b.createdAt) {
    return a.createdAt < b.createdAt ? -1 : 1;
  }
  if (a.createdAt && !b.createdAt) return 1;
  if (!a.createdAt && b.createdAt) return -1;
  if (a.kind !== b.kind) return a.kind === 'consumo' ? -1 : 1;
  return a.id - b.id;
};

const toEvents = (movements: StatementMovement[], payments: StatementPayment[]): StatementEvent[] => {
  const consumptionEvents: StatementEvent[] = movements.map((row, index) => {
    const cantidad = Math.abs(Number(row.cantidad) || 0);
    const isCopies = row.unidad === 'fotocopias';
    return {
      key: `c${row.id ?? index}`,
      kind: 'consumo',
      id: Number(row.id ?? index),
      fecha: normalizeDate(row.fecha),
      descripcion: row.descripcion || 'Consumo',
      amount: round2(isCopies ? cantidad / copiesPerQuetzal : cantidad),
      detail: isCopies ? `${cantidad.toLocaleString('es-GT')} copias` : '',
      copies: isCopies ? cantidad : 0,
      createdAt: normalizeCreatedAt(row.creado_en),
    };
  });

  const paymentEvents: StatementEvent[] = payments.map((row, index) => ({
    key: `p${row.id ?? index}`,
    kind: 'abono',
    id: Number(row.id ?? index),
    fecha: normalizeDate(row.fecha),
    descripcion: row.descripcion || 'Abono',
    amount: -round2(Math.abs(Number(row.monto) || 0)),
    detail: '',
    copies: 0,
    createdAt: normalizeCreatedAt(row.creado_en),
  }));

  return [...consumptionEvents, ...paymentEvents].sort(compareEvents);
};

const openingRow = (saldo: number): StatementRow => ({
  key: 'saldo-anterior',
  fecha: '',
  fechaLabel: '',
  descripcion: 'Saldo anterior',
  tipoLabel: '',
  detail: '',
  amount: 0,
  amountLabel: '',
  saldo,
  saldoLabel: formatSignedMoney(saldo),
  isOpening: true,
});

const eventRow = (event: StatementEvent, saldo: number): StatementRow => ({
  key: event.key,
  fecha: event.fecha,
  fechaLabel: formatDate(event.fecha),
  descripcion: event.descripcion,
  tipoLabel: event.kind === 'consumo' ? 'Consumo' : 'Abono',
  detail: event.detail,
  amount: event.amount,
  amountLabel: `${event.kind === 'consumo' ? '+' : '-'} ${formatMoney(event.amount)}`,
  saldo,
  saldoLabel: formatSignedMoney(saldo),
  isOpening: false,
});

export function buildClientStatement({
  movements,
  payments,
  reportType = 'desde_ultimo_abono',
  from = null,
  to = null,
  generatedAt = new Date(),
}: StatementReportOptions): StatementReport {
  const validationError = validateStatementOptions({ reportType, from, to });
  if (validationError) throw new Error(validationError);

  const events = toEvents(movements, payments);
  const abonos = events.filter((event) => event.kind === 'abono');
  // `events` ya está ordenado, así que el último abono es el de fecha más
  // reciente y, si hay varios el mismo día, el último registrado (creado_en/id).
  const lastAbono = abonos.length ? abonos[abonos.length - 1] : null;
  const lastAbonoIndex = lastAbono ? events.indexOf(lastAbono) : -1;

  let saldoAnterior = 0;
  let shown: StatementEvent[] = [];
  let canceled = false;
  let rangeFrom: string | null = null;
  let rangeTo: string | null = null;

  if (reportType === 'rango') {
    rangeFrom = normalizeDate(from);
    rangeTo = normalizeDate(to);
    // El saldo anterior de un rango se calcula con TODO lo anterior a la fecha
    // inicial, nunca filtrando antes de sumar.
    saldoAnterior = round2(
      events
        .filter((event) => event.fecha < rangeFrom!)
        .reduce((sum, event) => sum + event.amount, 0),
    );
    shown = events.filter((event) => event.fecha >= rangeFrom! && event.fecha <= rangeTo!);
  } else if (reportType === 'completo' || !lastAbono) {
    saldoAnterior = 0;
    shown = events;
  } else {
    const balanceAfterLastAbono = round2(
      events
        .slice(0, lastAbonoIndex + 1)
        .reduce((sum, event) => sum + event.amount, 0),
    );
    if (Math.abs(balanceAfterLastAbono) < 0.005) {
      // El último abono canceló la cuenta: se inicia en Q 0.00 y solo se
      // muestran los movimientos nuevos. Si no hay ninguno, cuenta cancelada.
      saldoAnterior = 0;
      shown = events.slice(lastAbonoIndex + 1);
      canceled = shown.length === 0;
    } else {
      saldoAnterior = round2(
        events
          .slice(0, lastAbonoIndex)
          .reduce((sum, event) => sum + event.amount, 0),
      );
      shown = events.slice(lastAbonoIndex);
    }
  }

  const rows: StatementRow[] = [openingRow(saldoAnterior)];
  let running = saldoAnterior;
  for (const event of shown) {
    running = round2(running + event.amount);
    rows.push(eventRow(event, running));
  }

  const totalConsumos = round2(
    shown.filter((event) => event.kind === 'consumo').reduce((sum, event) => sum + event.amount, 0),
  );
  const totalPagos = round2(
    shown.filter((event) => event.kind === 'abono').reduce((sum, event) => sum + Math.abs(event.amount), 0),
  );
  const saldoPendiente = round2(
    saldoAnterior + shown.reduce((sum, event) => sum + event.amount, 0),
  );
  const copies = round2(shown.reduce((sum, event) => sum + event.copies, 0));

  return {
    reportType,
    rows,
    saldoAnterior,
    totalConsumos,
    totalPagos,
    saldoPendiente,
    copies,
    shownCount: shown.length,
    canceled,
    lastAbono: lastAbono ? { fecha: lastAbono.fecha, fechaLabel: formatDate(lastAbono.fecha) } : null,
    rangeFrom,
    rangeTo,
    generatedAt,
    filename: reportFilename(reportType, generatedAt),
  };
}
