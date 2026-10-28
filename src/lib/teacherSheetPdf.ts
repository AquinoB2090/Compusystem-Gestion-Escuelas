import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

type TeacherSheetPdfOptions = {
  teacherName: string;
  month: string;
  unit: 'quetzales' | 'fotocopias';
  balance: number;
  entries: Array<{
    fecha: string;
    tipo: string;
    catedratico: string | null;
    descripcion: string;
    importe: number;
    saldo: number;
    unidad: 'fotocopias' | 'quetzales';
  }>;
};

const copiesPerQuetzal = 4;
const money = (amount: number) => `Q ${Number(amount || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const amountLabel = (amount: number, unit: 'quetzales' | 'fotocopias') => unit === 'quetzales'
  ? money(amount)
  : `${(Number(amount || 0) * copiesPerQuetzal).toLocaleString('es-GT', { maximumFractionDigits: 2 })} fotocopias`;
const dateLabel = (value: string) => value
  ? new Intl.DateTimeFormat('es-GT').format(new Date(`${value}T12:00:00`))
  : '';

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

export async function downloadTeacherSheetPdf({ teacherName, month, unit, balance, entries }: TeacherSheetPdfOptions) {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  const pageWidth = pdf.internal.pageSize.getWidth();
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

  const [year, monthNumber] = month.split('-').map(Number);
  const monthName = new Intl.DateTimeFormat('es-GT', { month: 'long', year: 'numeric' }).format(new Date(year, monthNumber - 1, 1));
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  pdf.text(`Seño: ${teacherName}`, 12, 61);
  pdf.text(`Mes: ${monthName}`, pageWidth * 0.56, 61);
  pdf.text(amountLabel(balance, unit), pageWidth - 12, 61, { align: 'right' });

  autoTable(pdf, {
    startY: 67,
    head: [['Fecha', 'Descripción', 'Cantidad', 'Saldo fotocopias']],
    body: entries.length
      ? entries.map((entry) => [
        dateLabel(entry.fecha),
        entry.catedratico || '',
        entry.tipo === 'ajuste'
          ? amountLabel(entry.importe, 'fotocopias')
          : entry.unidad === 'quetzales' ? money(entry.importe) : `${Number(entry.descripcion || 0).toLocaleString('es-GT')} fotocopias`,
        amountLabel(entry.saldo, 'fotocopias'),
      ])
      : [['', '', 'No hay consumos registrados para este mes.', '']],
    theme: 'grid',
    styles: { font: 'times', fontSize: 9, textColor: [25, 25, 25], lineColor: [68, 68, 68], lineWidth: 0.2, cellPadding: 2.2 },
    headStyles: { fontStyle: 'bold', fillColor: [255, 255, 255], textColor: [25, 25, 25] },
    columnStyles: { 0: { cellWidth: 27 }, 1: { cellWidth: 'auto' }, 2: { cellWidth: 43, halign: 'right' }, 3: { cellWidth: 36, halign: 'right' } },
    margin: { left: 12, right: 12, bottom: 18 },
    didDrawPage: () => {
      const pageHeight = pdf.internal.pageSize.getHeight();
      pdf.setDrawColor(210, 218, 213);
      pdf.line(12, pageHeight - 14, pageWidth - 12, pageHeight - 14);
      pdf.setFont('times', 'normal');
      pdf.setFontSize(7);
      pdf.setTextColor(95, 105, 99);
      pdf.text('Venta y soporte técnico · Computadoras · Cámaras de seguridad · Control de acceso · Desarrollo de software', 12, pageHeight - 9);
    },
  });

  const safeTeacherName = teacherName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
  pdf.save(`formato-${safeTeacherName}-${month}.pdf`);
}
