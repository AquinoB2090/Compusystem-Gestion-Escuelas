import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  buildClientStatement,
  formatDate,
  formatMoney,
  formatSignedMoney,
  reportPeriodLabel,
  reportTitle,
  type ReportType,
  type StatementMovement,
  type StatementPayment,
} from './clientStatement';

export type ClientStatementPdfOptions = {
  clientName: string;
  phone?: string | null;
  movements: StatementMovement[];
  payments: StatementPayment[];
  reportType?: ReportType;
  from?: string | null;
  to?: string | null;
  generatedAt?: Date;
};

const isoDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

async function loadLogoData(): Promise<string | null> {
  try {
    const response = await fetch('/compusystem-logo.jpeg');
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function buildClientStatementPdf(options: ClientStatementPdfOptions) {
  const statement = buildClientStatement(options);
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const logo = await loadLogoData();

  if (logo) pdf.addImage(logo, 'JPEG', (pageWidth - 36) / 2, 8, 36, 22);

  pdf.setFont('times', 'bolditalic');
  pdf.setFontSize(10);
  pdf.text('Prop. Olga Marina Arrivillaga Aldana de Aquino', pageWidth / 2, 35, { align: 'center' });
  pdf.setFont('times', 'italic');
  pdf.setFontSize(8);
  pdf.text('Barrio El Porvenir, Guastatoya, El Progreso', pageWidth / 2, 40, { align: 'center' });
  pdf.text('Tel. 7945-0482 · e-mail: compussystem@hotmail.com', pageWidth / 2, 44, { align: 'center' });
  pdf.text('NIT 48577030', pageWidth / 2, 48, { align: 'center' });

  pdf.setDrawColor(55, 55, 55);
  pdf.setLineWidth(0.4);
  pdf.line(12, 53, pageWidth - 12, 53);

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  pdf.text(`Cliente: ${options.clientName}`, 12, 61);
  if (options.phone) pdf.text(`Teléfono: ${options.phone}`, pageWidth * 0.5, 61);
  pdf.text(`Emitido: ${formatDate(isoDate(statement.generatedAt))}`, pageWidth - 12, 61, { align: 'right' });

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(11);
  pdf.text(reportTitle(statement.reportType, statement.rangeFrom, statement.rangeTo), 12, 69);

  pdf.setFont('times', 'italic');
  pdf.setFontSize(8);
  pdf.setTextColor(95, 105, 99);
  pdf.text(reportPeriodLabel({
    reportType: statement.reportType,
    lastAbono: statement.lastAbono,
    from: statement.rangeFrom,
    to: statement.rangeTo,
  }), 12, 75);

  let tableStart = 82;
  if (statement.canceled) {
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(40, 121, 80);
    pdf.text('Cuenta cancelada: el último abono dejó el saldo en Q 0.00.', 12, 81);
    tableStart = 87;
  } else if (!statement.shownCount) {
    pdf.text('Sin movimientos en el período.', 12, 81);
    tableStart = 87;
  }
  pdf.setTextColor(25, 25, 25);

  const body = statement.rows.map((row) => [
    row.fechaLabel,
    row.descripcion,
    row.tipoLabel,
    row.amountLabel ? `${row.amountLabel}${row.detail ? ` · ${row.detail}` : ''}` : '',
    row.saldoLabel,
  ]);

  const drawFooter = () => {
    pdf.setDrawColor(210, 218, 213);
    pdf.line(12, pageHeight - 14, pageWidth - 12, pageHeight - 14);
    pdf.setFont('times', 'normal');
    pdf.setFontSize(7);
    pdf.setTextColor(95, 105, 99);
    pdf.text('Venta y soporte técnico · Computadoras · Cámaras de seguridad · Control de acceso · Desarrollo de software', 12, pageHeight - 9);
    pdf.setTextColor(25, 25, 25);
  };

  autoTable(pdf, {
    startY: tableStart,
    head: [['Fecha', 'Descripción', 'Tipo', 'Movimiento', 'Saldo (Q)']],
    body,
    theme: 'grid',
    styles: { font: 'times', fontSize: 9, textColor: [25, 25, 25], lineColor: [68, 68, 68], lineWidth: 0.2, cellPadding: 2.2 },
    headStyles: { fontStyle: 'bold', fillColor: [255, 255, 255], textColor: [25, 25, 25] },
    columnStyles: {
      0: { cellWidth: 24 },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 20 },
      3: { cellWidth: 46, halign: 'right' },
      4: { cellWidth: 31, halign: 'right' },
    },
    margin: { left: 12, right: 12, bottom: 22 },
    didParseCell: (data) => {
      if (data.section === 'body' && data.row.index === 0) {
        data.cell.styles.fontStyle = 'bold';
      }
    },
    didDrawPage: drawFooter,
  });

  const lastTable = (pdf as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable;
  let summaryY = (lastTable?.finalY ?? tableStart) + 8;
  if (summaryY + 30 > pageHeight - 20) {
    pdf.addPage();
    summaryY = 20;
  }

  autoTable(pdf, {
    startY: summaryY,
    head: [['Resumen del reporte', '']],
    body: [
      ['Total consumos mostrados', formatMoney(statement.totalConsumos)],
      ['Total pagos mostrados', formatMoney(statement.totalPagos)],
      ['Saldo pendiente total', formatSignedMoney(statement.saldoPendiente)],
    ],
    theme: 'grid',
    styles: { font: 'times', fontSize: 9, textColor: [25, 25, 25], lineColor: [68, 68, 68], lineWidth: 0.2, cellPadding: 2.2 },
    headStyles: { fontStyle: 'bold', fillColor: [255, 255, 255], textColor: [25, 25, 25] },
    columnStyles: {
      0: { cellWidth: 75 },
      1: { cellWidth: 'auto', halign: 'right' },
    },
    margin: { left: 12, right: 12, bottom: 22 },
    didParseCell: (data) => {
      if (data.section === 'body' && data.row.index === 2) {
        data.cell.styles.fontStyle = 'bold';
      }
    },
    didDrawPage: drawFooter,
  });

  return { pdf, filename: statement.filename, statement };
}

export async function downloadClientStatementPdf(options: ClientStatementPdfOptions) {
  const { pdf, filename } = await buildClientStatementPdf(options);
  pdf.save(filename);
}
