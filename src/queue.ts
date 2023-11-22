import pLimit, { LimitFunction } from 'p-limit';

export class ConcurrentQueue {
  Q: LimitFunction;
  todo = new Map<number, Promise<unknown>>();
  taskCount = 0;
  events: (() => void)[] = [];

  constructor(limit: number) {
    this.Q = pLimit(limit);
  }

  /** Add a task to the queue */
  push<T>(cb: () => Promise<T>): Promise<T> {
    const taskId = this.taskCount++;
    const p = this.Q(cb).finally(() => {
      this.todo.delete(taskId);
      if (this.todo.size === 0) this.emitEmpty();
    });
    this.todo.set(taskId, p);
    return p;
  }

  onEmpty(cb: () => void): void {
    this.events.push(cb);
  }
  private emitEmpty(): void {
    for (const evt of this.events) evt();
  }

  /** Wait for all tasks to finish */
  async join(): Promise<void> {
    while (this.todo.size > 0) await Promise.all([...this.todo.values()]);
  }
}
