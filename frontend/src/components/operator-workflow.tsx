'use client';
import { useEffect, useRef, useState } from 'react';
import { getOperatorOrder } from '../lib/api/operator-orders';
import { canRetryOriginal, sendWorkflow, type WorkflowCommand, type WorkflowTarget } from '../lib/api/operator-workflow';
import { OrderError } from '../lib/api/orders';
import type { OperatorOrderDetail } from '../types/operator-order';
import type { UserRole } from '../types/auth';

export type WorkflowPhase = 'idle' | 'confirm' | 'pending' | 'conflict' | 'unresolved' | 'retry' | 'confirmed';
const actions = { PAID: { target: 'PREPARING', label: 'Bắt đầu pha chế' }, PREPARING: { target: 'READY', label: 'Đánh dấu sẵn sàng' },
  READY: { target: 'COMPLETED', label: 'Hoàn thành đơn' } } as const;
export function WorkflowControls({ order, role, phase, message, act, confirm, dismiss, reload, retry }: {
  order: OperatorOrderDetail; role: UserRole; phase: WorkflowPhase; message: string;
  act: (target: WorkflowTarget) => void; confirm: () => void; dismiss: () => void; reload: () => void; retry: () => void;
}) {
  if (!['STAFF', 'ADMIN'].includes(role)) return null;
  const action = Object.hasOwn(actions, order.status) ? actions[order.status as keyof typeof actions] : undefined;
  return <section className="operator-workflow" aria-label="Xử lý đơn hàng" aria-busy={phase === 'pending'}>
    {message && <p role={['conflict', 'unresolved', 'retry', 'confirmed'].includes(phase) ? 'alert' : 'status'}>{message}</p>}
    {phase === 'pending' && <p role="status">Đang xử lý thao tác…</p>}
    <div className="workflow-actions">{action && <button type="button" className="button" data-workflow-target={action.target} disabled={phase !== 'idle'} onClick={() => act(action.target)}>{action.label}</button>}
      {role === 'ADMIN' && order.status === 'PAID' && <button type="button" className="button workflow-danger" data-workflow-cancel disabled={phase !== 'idle'} onClick={() => act('CANCELLED')}>Hủy đơn đã thanh toán</button>}</div>
    {phase === 'confirm' && role === 'ADMIN' && order.status === 'PAID' && <fieldset data-paid-cancel-confirm><legend>Xác nhận hủy đơn đã thanh toán</legend>
      <p>Thao tác sẽ hoàn tồn theo số lượng trong đơn và thu hồi điểm tích lũy của đơn. Hủy đơn không đồng nghĩa hoàn tiền; Payment đã thành công vẫn được giữ nguyên.</p>
      {(order.redeemedPoints ?? 0)>0&&<p>Hoàn lại {order.redeemedPoints} điểm đã dùng. Điểm hoàn sẽ bù nghĩa vụ thu hồi trước; điểm thưởng gốc vẫn được thu hồi đầy đủ.</p>}
      <div className="workflow-actions"><button type="button" className="button workflow-danger" data-confirm-paid-cancel onClick={confirm}>Xác nhận hủy đơn</button>
        <button type="button" className="button" onClick={dismiss}>Giữ đơn</button></div></fieldset>}
    {['conflict', 'unresolved', 'retry', 'confirmed'].includes(phase) && <button type="button" className="button" data-workflow-reload onClick={reload}>Đọc lại trạng thái đơn</button>}
    {phase === 'retry' && <button type="button" className="button" data-workflow-original-retry onClick={retry}>Thử lại thao tác đã gửi</button>}
  </section>;
}
export function OperatorWorkflow({ order, role, onCurrent, onBusy, onDenied }: {
  order: OperatorOrderDetail; role: UserRole; onCurrent: (order: OperatorOrderDetail) => void; onBusy: (busy: boolean) => void; onDenied: (code: string) => void;
}) {
  const [phase, setPhase] = useState<WorkflowPhase>('idle'); const [message, setMessage] = useState('');
  const phaseRef = useRef<WorkflowPhase>('idle'); const gate = useRef(false); const alive = useRef(true);
  const controller = useRef(new AbortController()); const command = useRef<WorkflowCommand | null>(null); const committed = useRef(false);
  useEffect(() => { alive.current = true; controller.current = new AbortController(); return () => { alive.current = false; controller.current.abort(); }; }, []);
  function stage(value: WorkflowPhase) { phaseRef.current = value; setPhase(value); onBusy(value !== 'idle'); }
  function denied(error: unknown): boolean {
    if (!alive.current) return true;
    const code = error instanceof OrderError ? error.code : 'UNAVAILABLE';
    if (['UNAUTHORIZED', 'FORBIDDEN', 'ORDER_NOT_FOUND'].includes(code)) { onDenied(code); return true; }
    return false;
  }
  async function reconcile() {
    const original = command.current; if (!original || !alive.current) return;
    try {
      const current = await getOperatorOrder(original.id, controller.current.signal); if (!alive.current) return;
      onCurrent(current);
      if (!committed.current && phaseRef.current !== 'conflict' && canRetryOriginal(original, current)) {
        stage('retry'); setMessage('Chưa xác nhận được kết quả thao tác. Đơn vẫn ở trạng thái và phiên bản đã đọc; bạn có thể thử lại đúng thao tác cũ.');
      } else {
        stage('idle'); command.current = null;
        setMessage(committed.current ? 'Máy chủ đã xác nhận thao tác. Đã đọc lại trạng thái hiện tại.' : 'Đã đọc lại dữ liệu hiện tại. Hãy kiểm tra và xác nhận thao tác mới nếu cần.');
      }
    } catch (error) {
      if (denied(error)) return;
      stage(committed.current ? 'confirmed' : phaseRef.current === 'conflict' ? 'conflict' : 'unresolved');
      setMessage(committed.current ? 'Máy chủ đã xác nhận thao tác nhưng chưa tải được trạng thái mới. Chỉ đọc lại đơn, không gửi lại thao tác.'
        : 'Chưa đọc được trạng thái hiện tại. Hãy đọc lại đơn trước khi thao tác tiếp.');
    }
  }
  async function run(original: WorkflowCommand) {
    if (gate.current || !alive.current) return; gate.current = true; command.current = original; committed.current = false; stage('pending'); setMessage('');
    try {
      await sendWorkflow(original, controller.current.signal); if (!alive.current) return; committed.current = true;
      await reconcile();
    } catch (error) {
      if (denied(error)) return;
      const code = error instanceof OrderError ? error.code : 'UNAVAILABLE';
      if (['CONCURRENT_UPDATE', 'INVALID_ORDER_STATE', 'VALIDATION_ERROR'].includes(code)) {
        stage('conflict'); setMessage('Dữ liệu đã thay đổi hoặc thao tác không còn hợp lệ. Hãy đọc lại đơn và xác nhận thao tác mới; thao tác cũ không được tự gửi lại.');
      } else { await reconcile(); }
    } finally { gate.current = false; }
  }
  function act(target: WorkflowTarget) {
    if (gate.current || phaseRef.current !== 'idle') return;
    const original = { id: order.id, sourceStatus: order.status, expectedVersion: order.version, targetStatus: target };
    if (target === 'CANCELLED') { if (role !== 'ADMIN') return; command.current = original; stage('confirm'); }
    else void run(original);
  }
  function confirm() { if (phaseRef.current === 'confirm' && command.current) void run(command.current); }
  function retryOriginal() { if (phaseRef.current === 'retry' && command.current) void run(command.current); }
  async function reload() { if (gate.current) return; gate.current = true; try { await reconcile(); } finally { gate.current = false; } }
  return <WorkflowControls order={order} role={role} phase={phase} message={message} act={act} confirm={confirm}
    dismiss={() => { if (!gate.current) { command.current = null; stage('idle'); } }} reload={() => void reload()} retry={retryOriginal} />;
}
