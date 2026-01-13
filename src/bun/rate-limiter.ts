// =============================================================================
// Rate Limiter
// Smart request routing with automatic fallback and retry
// =============================================================================

import { config } from './config'
import type { ProviderType } from './types'

interface RequestRecord {
  timestamp: number
  provider: ProviderType
  success: boolean
}

export class RateLimiter {
  private requests: RequestRecord[] = []
  private primaryProvider: ProviderType = 'a4f'
  private fallbackProvider: ProviderType = 'cli_proxy'
  private consecutiveFailures: Map<ProviderType, number> = new Map()

  constructor(
    private maxRpm: number = config.rateLimitRpm,
    private windowMs: number = config.rateLimitWindowMs
  ) {}

  /**
   * Clean up old requests outside the time window
   */
  private cleanup(): void {
    const cutoff = Date.now() - this.windowMs
    this.requests = this.requests.filter(r => r.timestamp > cutoff)
  }

  /**
   * Get current request count for a provider
   */
  getRequestCount(provider: ProviderType = this.primaryProvider): number {
    this.cleanup()
    return this.requests.filter(r => r.provider === provider).length
  }

  /**
   * Check if we should use fallback provider
   * Uses smart logic: rate limit OR too many failures
   */
  shouldUseFallback(): boolean {
    const a4fCount = this.getRequestCount('a4f')
    const a4fFailures = this.consecutiveFailures.get('a4f') || 0

    // Use fallback if:
    // 1. Rate limit reached
    // 2. Too many consecutive failures (3+)
    return a4fCount >= this.maxRpm || a4fFailures >= 3
  }

  /**
   * Record a request with success/failure status
   */
  recordRequest(provider: ProviderType, success: boolean = true): void {
    this.requests.push({ timestamp: Date.now(), provider, success })

    if (success) {
      // Reset failure counter on success
      this.consecutiveFailures.set(provider, 0)
    } else {
      // Increment failure counter
      const current = this.consecutiveFailures.get(provider) || 0
      this.consecutiveFailures.set(provider, current + 1)
    }
  }

  /**
   * Mark the last request as failed (for retry logic)
   */
  markLastFailed(provider: ProviderType): void {
    const failures = this.consecutiveFailures.get(provider) || 0
    this.consecutiveFailures.set(provider, failures + 1)
    console.log(`[RateLimiter] ${provider} failure count: ${failures + 1}`)
  }

  /**
   * Get the appropriate provider based on rate limits and health
   */
  getProvider(): ProviderType {
    return this.shouldUseFallback() ? this.fallbackProvider : this.primaryProvider
  }

  /**
   * Get rate limit status info
   */
  getStatus(): {
    a4f: { count: number; limit: number; remaining: number; failures: number }
    cli_proxy: { count: number; failures: number }
    usingFallback: boolean
    windowMs: number
    resetAt: number
  } {
    this.cleanup()
    const a4fCount = this.getRequestCount('a4f')
    const cliProxyCount = this.getRequestCount('cli_proxy')

    const oldestA4fRequest = this.requests
      .filter(r => r.provider === 'a4f')
      .sort((a, b) => a.timestamp - b.timestamp)[0]

    return {
      a4f: {
        count: a4fCount,
        limit: this.maxRpm,
        remaining: Math.max(0, this.maxRpm - a4fCount),
        failures: this.consecutiveFailures.get('a4f') || 0
      },
      cli_proxy: {
        count: cliProxyCount,
        failures: this.consecutiveFailures.get('cli_proxy') || 0
      },
      usingFallback: this.shouldUseFallback(),
      windowMs: this.windowMs,
      resetAt: oldestA4fRequest ? oldestA4fRequest.timestamp + this.windowMs : Date.now()
    }
  }

  /**
   * Get time until rate limit resets (in ms)
   */
  getResetTime(): number {
    const status = this.getStatus()
    return Math.max(0, status.resetAt - Date.now())
  }

  /**
   * Reset failure counter for a provider (e.g., after successful health check)
   */
  resetFailures(provider: ProviderType): void {
    this.consecutiveFailures.set(provider, 0)
  }
}

// Singleton instance
export const rateLimiter = new RateLimiter()
