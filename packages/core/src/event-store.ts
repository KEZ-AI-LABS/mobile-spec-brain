import { eventSchema, type DomainEvent } from "./domain.js";

export interface EventStore {
  append(event: DomainEvent): Promise<void>;
  list(entityId: string): Promise<readonly DomainEvent[]>;
}

export class InMemoryEventStore implements EventStore {
  #events: DomainEvent[] = [];
  async append(event: DomainEvent): Promise<void> { this.#events.push(eventSchema.parse(event)); }
  async list(entityId: string): Promise<readonly DomainEvent[]> { return this.#events.filter((event) => event.entityId === entityId); }
}
