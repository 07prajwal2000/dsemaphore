import { MemoryTransport } from '../memory-transport';
import { transportContract } from '../contract';

transportContract('MemoryTransport', () => new MemoryTransport());
