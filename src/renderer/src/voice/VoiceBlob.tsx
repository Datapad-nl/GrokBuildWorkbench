import { useEffect, useRef, type JSX } from 'react'
import { getVoiceMotion, WAVE_BARS } from './engine'

const RINGS = 26
const STEPS = 96

export function VoiceBlob({
  variant,
  size = 'banner'
}: {
  variant: 'user' | 'grok' | 'idle'
  size?: 'banner' | 'chip'
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const node = canvasRef.current
    if (!node) return
    const gfx = node.getContext('2d')
    if (!gfx) return
    const canvas: HTMLCanvasElement = node
    const ctx: CanvasRenderingContext2D = gfx

    let raf = 0
    let t = 0
    let energy = 0
    const smooth = Array.from({ length: WAVE_BARS }, () => 0)
    const parent = canvas.parentElement

    function resize(): void {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const cssW = parent?.clientWidth || (size === 'chip' ? 28 : 280)
      const cssH = size === 'chip' ? 22 : 168
      canvas.style.width = `${cssW}px`
      canvas.style.height = `${cssH}px`
      canvas.width = Math.max(1, Math.round(cssW * dpr))
      canvas.height = Math.max(1, Math.round(cssH * dpr))
    }

    function radius(theta: number, ring: number, n: number): number {
      const u = ring / (n - 1)
      let r = 0.38 + energy * 0.28
      r += Math.sin(theta * 2 + t * 0.55) * (0.045 + energy * 0.07)
      r += Math.cos(theta * 3 - t * 0.4) * (0.038 + smooth[1] * 0.1)
      r += Math.sin(theta * 4 + t * 0.85) * (0.022 + smooth[2] * 0.09)
      r += Math.cos(theta * 5 + t * 0.28) * (0.018 + smooth[4] * 0.08)
      r += Math.sin(theta * 1 + t * 0.22) * (0.05 + smooth[0] * 0.12)
      r += Math.sin(theta * 7 - t * 0.6) * (0.012 + smooth[5] * 0.06)
      return r * (0.18 + u * 0.82)
    }

    function draw(): void {
      const motion = getVoiceMotion()
      const grok = variant === 'grok'
      const target = grok ? 0.42 + 0.22 * (0.5 + 0.5 * Math.sin(t * 3.2)) : motion.level
      energy += (target - energy) * 0.16
      for (let i = 0; i < WAVE_BARS; i++) {
        const src = grok ? 0.28 + 0.22 * (0.5 + 0.5 * Math.sin(t * (1.8 + i * 0.35) + i)) : (motion.bands[i] ?? 0)
        smooth[i] += (src - smooth[i]) * 0.22
      }
      t += 0.016 + energy * 0.01

      const w = canvas.width
      const h = canvas.height
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, w, h)

      const cx = w * 0.5
      const cy = h * 0.52
      const scale = Math.min(w, h) * 0.46
      const grad = ctx.createLinearGradient(cx - scale, cy, cx + scale, cy)
      if (grok) {
        grad.addColorStop(0, '#f5d78a')
        grad.addColorStop(0.5, '#c4a35a')
        grad.addColorStop(1, '#ff8a4c')
      } else {
        grad.addColorStop(0, '#4f8cff')
        grad.addColorStop(0.42, '#7c4dff')
        grad.addColorStop(1, '#f472e8')
      }

      ctx.globalCompositeOperation = 'lighter'
      ctx.lineJoin = 'round'
      const rings = size === 'chip' ? 10 : RINGS
      const steps = size === 'chip' ? 48 : STEPS
      for (let ring = 0; ring < rings; ring++) {
        ctx.beginPath()
        for (let i = 0; i <= steps; i++) {
          const theta = (i / steps) * Math.PI * 2
          const rad = radius(theta, ring, rings) * scale
          const x = cx + Math.cos(theta) * rad
          const y = cy + Math.sin(theta) * rad * 0.92
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.closePath()
        const fade = 0.08 + (1 - ring / rings) * 0.38
        ctx.globalAlpha = fade * (0.55 + energy * 0.45)
        ctx.strokeStyle = grad
        ctx.lineWidth = size === 'chip' ? 1 : Math.max(1, canvas.width / 280)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'
      raf = requestAnimationFrame(draw)
    }

    resize()
    const observer = new ResizeObserver(() => resize())
    if (parent) observer.observe(parent)
    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
    }
  }, [size, variant])

  return <canvas ref={canvasRef} className="block w-full" aria-hidden="true" />
}
