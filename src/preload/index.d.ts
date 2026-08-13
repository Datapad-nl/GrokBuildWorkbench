import type { GrokCodeApi } from './index'

declare global {
  interface Window {
    grokcode: GrokCodeApi
  }
}

export {}
