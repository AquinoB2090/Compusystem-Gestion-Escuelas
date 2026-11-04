import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildClientStatement,
  formatDate,
  formatMoney,
  formatSignedMoney,
  reportFilename,
  validateStatementOptions,
  type StatementMovement,
  type StatementPayment,
} from '../src/lib/clientStatement';

const movement = (overrides: Partial<StatementMovement> = {}): StatementMovement => ({
  id: 1,
  fecha: '2026-10-01',
  descripcion: 'Consumo',
  cantidad: 1,
  unidad: 'quetzales',
  creado_en: '2026-10-01T10:00:00.000Z',
  ...overrides,
});

const payment = (overrides: Partial<StatementPayment> = {}): StatementPayment => ({
  id: 1,
  fecha: '2026-10-20',
  descripcion: 'Abono',
  monto: 150,
  creado_en: '2026-10-20T10:00:00.000Z',
  ...overrides,
});

test('ejemplo solicitado: saldo anterior Q 500 y saldo pendiente Q 540', () => {
  const statement = buildClientStatement({
    movements: [
      movement({ id: 1, fecha: '2026-10-01', descripcion: 'Consumos anteriores', cantidad: 500 }),
      movement({ id: 3, fecha: '2026-10-21', descripcion: 'Diplomas', cantidad: 100 }),
      movement({ id: 4, fecha: '2026-10-22', descripcion: 'Lápices', cantidad: 20 }),
      movement({ id: 5, fecha: '2026-10-23', descripcion: 'Lapiceros', cantidad: 70 }),
    ],
    payments: [payment({ id: 2, fecha: '2026-10-20', monto: 150 })],
    generatedAt: new Date(2026, 10, 4, 7, 5),
  });

  assert.equal(statement.reportType, 'desde_ultimo_abono');
  assert.equal(statement.rows.length, 5);

  const opening = statement.rows[0];
  assert.equal(opening.descripcion, 'Saldo anterior');
  assert.equal(opening.saldo, 500);
  assert.equal(opening.saldoLabel, 'Q 500.00');

  assert.equal(statement.rows[1].descripcion, 'Abono');
  assert.equal(statement.rows[1].fechaLabel, '20/10/2026');
  assert.equal(statement.rows[1].amountLabel, '- Q 150.00');
  assert.equal(statement.rows[1].saldo, 350);

  assert.equal(statement.rows[2].descripcion, 'Diplomas');
  assert.equal(statement.rows[2].amountLabel, '+ Q 100.00');
  assert.equal(statement.rows[2].saldo, 450);

  assert.equal(statement.rows[3].descripcion, 'Lápices');
  assert.equal(statement.rows[3].saldo, 470);

  assert.equal(statement.rows[4].descripcion, 'Lapiceros');
  assert.equal(statement.rows[4].saldo, 540);
  assert.equal(statement.rows[4].saldoLabel, 'Q 540.00');

  assert.equal(statement.saldoAnterior, 500);
  assert.equal(statement.totalConsumos, 190);
  assert.equal(statement.totalPagos, 150);
  assert.equal(statement.saldoPendiente, 540);
  assert.equal(formatMoney(statement.saldoPendiente), 'Q 540.00');
  assert.equal(statement.canceled, false);
  assert.equal(statement.lastAbono?.fechaLabel, '20/10/2026');
});

test('cliente que nunca ha pagado: muestra todo desde el primer consumo', () => {
  const statement = buildClientStatement({
    movements: [
      movement({ id: 1, fecha: '2026-08-01', cantidad: 4, unidad: 'fotocopias' }),
      movement({ id: 2, fecha: '2026-08-15', cantidad: 25 }),
    ],
    payments: [],
  });

  assert.equal(statement.lastAbono, null);
  assert.equal(statement.saldoAnterior, 0);
  assert.equal(statement.rows[0].saldoLabel, 'Q 0.00');
  assert.equal(statement.rows.length, 3);
  assert.equal(statement.rows[1].amount, 1);
  assert.equal(statement.rows[1].detail, '4 copias');
  assert.equal(statement.rows[2].saldo, 26);
  assert.equal(statement.saldoPendiente, 26);
  assert.equal(statement.totalPagos, 0);
  assert.equal(statement.totalConsumos, 26);
  assert.equal(statement.canceled, false);
});

test('el último abono cancela la cuenta y no hay movimientos nuevos', () => {
  const statement = buildClientStatement({
    movements: [movement({ id: 1, fecha: '2026-09-01', cantidad: 300 })],
    payments: [payment({ id: 2, fecha: '2026-09-15', monto: 300 })],
  });

  assert.equal(statement.canceled, true);
  assert.equal(statement.saldoAnterior, 0);
  assert.equal(statement.saldoPendiente, 0);
  assert.equal(statement.shownCount, 0);
  assert.equal(statement.rows.length, 1);
  assert.equal(statement.rows[0].descripcion, 'Saldo anterior');
  assert.equal(statement.totalPagos, 0);
});

test('el último abono cancela la cuenta y luego hay consumos nuevos', () => {
  const statement = buildClientStatement({
    movements: [
      movement({ id: 1, fecha: '2026-09-01', cantidad: 300 }),
      movement({ id: 4, fecha: '2026-09-20', descripcion: 'Consumo nuevo', cantidad: 40 }),
    ],
    payments: [payment({ id: 2, fecha: '2026-09-15', monto: 300 })],
  });

  assert.equal(statement.canceled, false);
  assert.equal(statement.saldoAnterior, 0);
  assert.equal(statement.rows.length, 2);
  assert.equal(statement.rows[1].descripcion, 'Consumo nuevo');
  assert.equal(statement.rows[1].saldo, 40);
  assert.equal(statement.saldoPendiente, 40);
  assert.equal(statement.totalPagos, 0);
});

test('varios abonos el mismo día: usa el último registrado como corte', () => {
  const statement = buildClientStatement({
    movements: [movement({ id: 1, fecha: '2026-09-01', cantidad: 100 })],
    payments: [
      payment({ id: 2, fecha: '2026-09-05', descripcion: 'Primer abono', monto: 40, creado_en: '2026-09-05T08:00:00.000Z' }),
      payment({ id: 3, fecha: '2026-09-05', descripcion: 'Segundo abono', monto: 30, creado_en: '2026-09-05T09:00:00.000Z' }),
    ],
  });

  assert.equal(statement.lastAbono?.fecha, '2026-09-05');
  assert.equal(statement.saldoAnterior, 60);
  assert.equal(statement.rows.length, 2);
  assert.equal(statement.rows[0].saldo, 60);
  assert.equal(statement.rows[1].descripcion, 'Segundo abono');
  assert.equal(statement.rows[1].amountLabel, '- Q 30.00');
  assert.equal(statement.rows[1].saldo, 30);
  assert.equal(statement.totalPagos, 30);
  assert.equal(statement.saldoPendiente, 30);
});

test('abono sin consumos posteriores', () => {
  const statement = buildClientStatement({
    movements: [movement({ id: 1, fecha: '2026-10-01', cantidad: 200 })],
    payments: [payment({ id: 2, fecha: '2026-10-10', monto: 50 })],
  });

  assert.equal(statement.saldoAnterior, 200);
  assert.equal(statement.rows.length, 2);
  assert.equal(statement.rows[1].descripcion, 'Abono');
  assert.equal(statement.rows[1].saldo, 150);
  assert.equal(statement.saldoPendiente, 150);
  assert.equal(statement.totalConsumos, 0);
  assert.equal(statement.totalPagos, 50);
});

test('rango: el saldo anterior suma todo lo anterior a la fecha inicial', () => {
  const statement = buildClientStatement({
    movements: [
      movement({ id: 1, fecha: '2026-09-01', cantidad: 100 }),
      movement({ id: 3, fecha: '2026-10-05', descripcion: 'Consumo de octubre', cantidad: 50 }),
      movement({ id: 5, fecha: '2026-11-01', descripcion: 'Fuera del rango', cantidad: 10 }),
    ],
    payments: [
      payment({ id: 2, fecha: '2026-09-10', monto: 30 }),
      payment({ id: 4, fecha: '2026-10-20', monto: 20 }),
    ],
    reportType: 'rango',
    from: '2026-10-01',
    to: '2026-10-31',
  });

  assert.equal(statement.saldoAnterior, 70);
  assert.equal(statement.rows.length, 3);
  assert.equal(statement.rows[0].saldo, 70);
  assert.equal(statement.rows[1].descripcion, 'Consumo de octubre');
  assert.equal(statement.rows[1].saldo, 120);
  assert.equal(statement.rows[2].descripcion, 'Abono');
  assert.equal(statement.rows[2].saldo, 100);
  assert.equal(statement.totalConsumos, 50);
  assert.equal(statement.totalPagos, 20);
  assert.equal(statement.saldoPendiente, 100);
  assert.equal(statement.rangeFrom, '2026-10-01');
  assert.equal(statement.rangeTo, '2026-10-31');
});

test('reporte completo incluye todo el historial con saldo anterior en cero', () => {
  const statement = buildClientStatement({
    movements: [movement({ id: 1, fecha: '2026-08-01', cantidad: 10 })],
    payments: [payment({ id: 2, fecha: '2026-08-10', monto: 5 })],
    reportType: 'completo',
  });

  assert.equal(statement.saldoAnterior, 0);
  assert.equal(statement.rows.length, 3);
  assert.equal(statement.rows[2].saldo, 5);
  assert.equal(statement.saldoPendiente, 5);
  assert.equal(statement.totalConsumos, 10);
  assert.equal(statement.totalPagos, 5);
});

test('valida el tipo de reporte y el rango de fechas', () => {
  assert.equal(validateStatementOptions({ reportType: 'rango', from: '', to: '' }), 'Selecciona la fecha de inicio y la fecha de fin.');
  assert.equal(
    validateStatementOptions({ reportType: 'rango', from: '2026-10-20', to: '2026-10-01' }),
    'La fecha de inicio no puede ser posterior a la fecha de fin.',
  );
  assert.equal(validateStatementOptions({ reportType: 'rango', from: '2026-10-01', to: '2026-10-31' }), null);
  assert.throws(
    () => buildClientStatement({ movements: [], payments: [], reportType: 'rango', from: '2026-10-31', to: '2026-10-01' }),
    /La fecha de inicio no puede ser posterior/,
  );
});

test('formatos de fecha, montos y nombre de archivo', () => {
  assert.equal(formatDate('2026-10-20'), '20/10/2026');
  assert.equal(formatDate('2026-10-20T12:00:00.000Z'), '20/10/2026');
  assert.equal(formatDate(''), '');
  assert.equal(formatMoney(1234), 'Q 1,234.00');
  assert.equal(formatMoney(-150.5), 'Q 150.50');
  assert.equal(formatSignedMoney(-150), '- Q 150.00');
  assert.equal(formatSignedMoney(540), 'Q 540.00');
  assert.equal(reportFilename('rango', new Date(2026, 10, 4, 7, 5)), '2026-11-04_0705_rango.pdf');
  assert.equal(reportFilename('desde_ultimo_abono', new Date(2026, 0, 9, 18, 30)), '2026-01-09_1830_desde_ultimo_abono.pdf');
});
