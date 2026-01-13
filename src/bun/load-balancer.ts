// =============================================================================
// Load Balancer
// Smart request distribution between A4F and CLI Proxy
// =============================================================================

import { config } from './config'
import type { ProviderType } from './types'

interface ProviderStats {
  requests: number[]  // timestamps of recent requests
  failures: number
  lastFailure: number
  avgResponseTime: number
  responseTimes: number[]
}

export class LoadBalancer {
  private stats: Map<ProviderType, ProviderStats> = new Map()
  private windowMs: number = 60000  // 1 minute window
  private a4fLimit: number
  private currentProvider: ProviderType = 'a4f'
  private requestCounter: number = 0

  constructor() {
    this.a4fLimit = config.rateLimitRpm
    this.stats.set('a4f', this.createStats())
    this.stats.set('cli_proxy', this.createStats())
  }

  private createStats(): ProviderStats {
    return {
      requests: [],
      failures: 0,
      lastFailure: 0,
      avgResponseTime: 0,
      responseTimes: []
    }
  }

  private cleanup(stats: ProviderStats): void {
    const cutoff = Date.now() - this.windowMs
    stats.requests = stats.requests.filter(t => t > cutoff)
    // Keep only last 10 response times
    if (stats.responseTimes.length > 10) {
      stats.responseTimes = stats.responseTimes.slice(-10)
    }
  }

  /**
   * Get the best provider using weighted round-robin
   * Strategy: Distribute requests to stay under A4F limit while maximizing throughput
   */
  getProvider(): ProviderType {
    const a4f = this.stats.get('a4f')!
    const cliProxy = this.stats.get('cli_proxy')!

    this.cleanup(a4f)
    this.cleanup(cliProxy)

    // If A4F has recent failures (within 30 seconds), prefer CLI Proxy
    if (a4f.failures >= 2 && Date.now() - a4f.lastFailure < 30000) {
      console.log(`[LoadBalancer] A4F has ${a4f.failures} recent failures, using CLI Proxy`)
      return 'cli_proxy'
    }

    // Check A4F rate limit - leave 2 request buffer
    const a4fCount = a4f.requests.length
    if (a4fCount >= this.a4fLimit - 2) {
      console.log(`[LoadBalancer] A4F near limit (${a4fCount}/${this.a4fLimit}), using CLI Proxy`)
      return 'cli_proxy'
    }

    // Weighted distribution: 90% A4F, 10% CLI Proxy
    // This preserves CLI Proxy quota while maximizing A4F usage
    this.requestCounter++
    if (this.requestCounter % 10 < 9) {
      // 9 out of 10 requests go to A4F
      return 'a4f'
    } else {
      // 1 out of 10 requests go to CLI Proxy
      return 'cli_proxy'
    }
  }

  /**
   * Record a request start
   */
  recordRequest(provider: ProviderType): number {
    const stats = this.stats.get(provider)!
    stats.requests.push(Date.now())
    return Date.now()
  }

  /**
   * Record request completion with success/failure and timing
   */
  recordResult(provider: ProviderType, success: boolean, startTime: number): void {
    const stats = this.stats.get(provider)!
    const duration = Date.now() - startTime

    if (success) {
      stats.failures = 0
      stats.responseTimes.push(duration)
      stats.avgResponseTime = stats.responseTimes.reduce((a, b) => a + b, 0) / stats.responseTimes.length
    } else {
      stats.failures++
      stats.lastFailure = Date.now()
      console.log(`[LoadBalancer] ${provider} failure #${stats.failures}`)
    }
  }

  /**
   * Check if we should retry with fallback provider
   */
  shouldRetry(failedProvider: ProviderType): boolean {
    // Always retry with the other provider on failure
    return true
  }

  /**
   * Get the fallback provider
   */
  getFallback(currentProvider: ProviderType): ProviderType {
    return currentProvider === 'a4f' ? 'cli_proxy' : 'a4f'
  }

  /**
   * Get status for health endpoint
   */
  getStatus() {
    const a4f = this.stats.get('a4f')!
    const cliProxy = this.stats.get('cli_proxy')!

    this.cleanup(a4f)
    this.cleanup(cliProxy)

    return {
      a4f: {
        count: a4f.requests.length,
        limit: this.a4fLimit,
        remaining: Math.max(0, this.a4fLimit - a4f.requests.length),
        failures: a4f.failures,
        avgResponseTime: Math.round(a4f.avgResponseTime)
      },
      cli_proxy: {
        count: cliProxy.requests.length,
        failures: cliProxy.failures,
        avgResponseTime: Math.round(cliProxy.avgResponseTime)
      },
      strategy: 'weighted-round-robin',
      distribution: '60% A4F / 40% CLI Proxy'
    }
  }
}

// Singleton instance
export const loadBalancer = new LoadBalancer()
