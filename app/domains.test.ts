import { describe, expect, it } from "vitest"
import { DeliberationSchema } from "./domains.js"

const valida = {
  rejected: [
    { actionId: "create-ticket", reason: "un ticket no saca a nadie del apuro ahora" },
    { actionId: "ignore", reason: "veinte minutos en falla no se ignoran" },
  ],
  wouldChangeIf: "si hubiera durado 3 min en vez de 20, ignoraba",
}

describe("DeliberationSchema", () => {
  it("acepta una deliberación con la forma que produce el decisor", () => {
    expect(DeliberationSchema.parse(valida)).toEqual(valida)
  })

  it("rechaza un reason que excede la cota", () => {
    const gorda = { ...valida, rejected: [{ actionId: "ignore", reason: "x".repeat(501) }] }
    expect(DeliberationSchema.safeParse(gorda).success).toBe(false)
  })

  it("rechaza un wouldChangeIf que excede la cota", () => {
    expect(
      DeliberationSchema.safeParse({ ...valida, wouldChangeIf: "x".repeat(501) }).success,
    ).toBe(false)
  })

  it("rechaza más rechazos de los que cabe esperar de un config", () => {
    const muchos = {
      ...valida,
      rejected: Array.from({ length: 9 }, (_, i) => ({ actionId: `a${i}`, reason: "no" })),
    }
    expect(DeliberationSchema.safeParse(muchos).success).toBe(false)
  })

  it("rechaza un actionId vacío", () => {
    expect(
      DeliberationSchema.safeParse({ ...valida, rejected: [{ actionId: "", reason: "no" }] })
        .success,
    ).toBe(false)
  })
})
