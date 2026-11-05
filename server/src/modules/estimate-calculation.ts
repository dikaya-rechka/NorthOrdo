export type CalculationBase = {
  repetitions: string
  wastePercent: string
}

export type EstimateCalculationInput = CalculationBase & (
  | { mode: 'manual'; quantity: string }
  | { mode: 'length'; length: string }
  | { mode: 'area'; length: string; width: string }
  | { mode: 'perimeter'; length: string; width: string }
  | { mode: 'volume'; length: string; width: string; height: string }
  | { mode: 'circle_area'; radius: string }
  | { mode: 'circle_circumference'; radius: string }
  | { mode: 'triangle_area'; base: string; height: string }
  | { mode: 'cylinder_volume'; radius: string; height: string }
  | { mode: 'wall_area'; wallLengths: string[]; height: string; openingsArea: string }
  | { mode: 'formula'; expression: string; variables: { name: string; value: string }[] }
)

export type CalculatedQuantity = {
  calculation: EstimateCalculationInput
  quantity: string
}

const reservedFormulaNames = new Set([
  'PI', 'E', 'ABS', 'SQRT', 'SIN', 'COS', 'TAN', 'FLOOR', 'CEIL', 'ROUND', 'MIN', 'MAX', 'POW',
])

function getRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function getString(record: Record<string, unknown>, key: string): string | null {
  return typeof record[key] === 'string' ? (record[key] as string).trim() : null
}

function trimDecimal(text: string): string {
  return text.replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1')
}

function normalizeDecimal(value: unknown, allowZero = true): { text: string; number: number } | null {
  if (typeof value !== 'string') return null
  const text = value.trim().replace(',', '.')
  if (!/^(?:0|[1-9]\d{0,5})(?:\.\d{1,3})?$/.test(text)) return null
  const number = Number(text)
  if (!Number.isFinite(number) || number > 999_999.999 || (!allowZero && number <= 0)) return null
  return { text: trimDecimal(number.toFixed(3)), number }
}

function normalizeCommon(record: Record<string, unknown>): {
  repetitionsText: string
  repetitions: number
  wasteText: string
  wastePercent: number
} | null {
  const repetitionsText = (getString(record, 'repetitions') ?? '1').replace(',', '.')
  if (!/^[1-9]\d{0,3}$/.test(repetitionsText)) return null
  const repetitions = Number(repetitionsText)
  if (repetitions > 10_000) return null

  const wasteValue = (getString(record, 'wastePercent') ?? '0').replace(',', '.')
  if (!/^(?:0|[1-9]\d{0,2})(?:\.\d{1,3})?$/.test(wasteValue)) return null
  const wastePercent = Number(wasteValue)
  if (!Number.isFinite(wastePercent) || wastePercent > 100) return null

  return {
    repetitionsText,
    repetitions,
    wasteText: trimDecimal(wastePercent.toFixed(3)),
    wastePercent,
  }
}

class FormulaParser {
  private position = 0
  private steps = 0
  private nesting = 0
  private readonly source: string
  private readonly variables: Map<string, number>

  constructor(source: string, variables: Map<string, number>) {
    this.source = source
    this.variables = variables
  }

  parse(): number {
    const result = this.expression()
    this.skipSpaces()
    if (this.position !== this.source.length || !Number.isFinite(result)) throw new Error('invalid_formula')
    return result
  }

  private expression(): number {
    let value = this.term()
    while (true) {
      this.skipSpaces()
      const operator = this.source[this.position]
      if (operator !== '+' && operator !== '-') return value
      this.position += 1
      this.tick()
      const right = this.term()
      value = operator === '+' ? value + right : value - right
      if (!Number.isFinite(value)) throw new Error('invalid_formula')
    }
  }

  private term(): number {
    let value = this.unary()
    while (true) {
      this.skipSpaces()
      const operator = this.source[this.position]
      if (operator !== '*' && operator !== '/') return value
      this.position += 1
      this.tick()
      const right = this.unary()
      if (operator === '/' && right === 0) throw new Error('division_by_zero')
      value = operator === '*' ? value * right : value / right
      if (!Number.isFinite(value)) throw new Error('invalid_formula')
    }
  }

  private unary(): number {
    this.skipSpaces()
    const operator = this.source[this.position]
    if (operator !== '+' && operator !== '-') return this.power()
    this.position += 1
    this.tick()
    this.enterNesting()
    try {
      const value = this.unary()
      return operator === '-' ? -value : value
    } finally {
      this.nesting -= 1
    }
  }

  private power(): number {
    const base = this.primary()
    this.skipSpaces()
    if (this.source[this.position] !== '^') return base
    this.position += 1
    this.tick()
    const exponent = this.unary()
    if (Math.abs(exponent) > 10) throw new Error('invalid_formula')
    const value = base ** exponent
    if (!Number.isFinite(value)) throw new Error('invalid_formula')
    return value
  }

  private primary(): number {
    this.skipSpaces()
    if (this.source[this.position] === '(') {
      this.position += 1
      this.tick()
      this.enterNesting()
      try {
        const value = this.expression()
        this.skipSpaces()
        if (this.source[this.position] !== ')') throw new Error('invalid_formula')
        this.position += 1
        this.tick()
        return value
      } finally {
        this.nesting -= 1
      }
    }

    const rest = this.source.slice(this.position)
    const numberMatch = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(rest)
    if (numberMatch) {
      this.position += numberMatch[0].length
      this.tick()
      const value = Number(numberMatch[0])
      if (!Number.isFinite(value)) throw new Error('invalid_formula')
      return value
    }

    const variableMatch = /^[A-Za-z][A-Za-z0-9_]*/.exec(rest)
    if (!variableMatch) throw new Error('invalid_formula')
    this.position += variableMatch[0].length
    this.tick()
    const name = variableMatch[0].toUpperCase()
    this.skipSpaces()

    if (this.source[this.position] === '(') {
      const args = this.functionArguments()
      let value: number
      switch (name) {
        case 'ABS': if (args.length !== 1) throw new Error('invalid_formula'); value = Math.abs(args[0]); break
        case 'SQRT': if (args.length !== 1 || args[0] < 0) throw new Error('invalid_formula'); value = Math.sqrt(args[0]); break
        case 'SIN': if (args.length !== 1) throw new Error('invalid_formula'); value = Math.sin(args[0]); break
        case 'COS': if (args.length !== 1) throw new Error('invalid_formula'); value = Math.cos(args[0]); break
        case 'TAN': if (args.length !== 1) throw new Error('invalid_formula'); value = Math.tan(args[0]); break
        case 'FLOOR': if (args.length !== 1) throw new Error('invalid_formula'); value = Math.floor(args[0]); break
        case 'CEIL': if (args.length !== 1) throw new Error('invalid_formula'); value = Math.ceil(args[0]); break
        case 'ROUND': if (args.length !== 1) throw new Error('invalid_formula'); value = Math.round(args[0]); break
        case 'MIN': if (args.length !== 2) throw new Error('invalid_formula'); value = Math.min(args[0], args[1]); break
        case 'MAX': if (args.length !== 2) throw new Error('invalid_formula'); value = Math.max(args[0], args[1]); break
        case 'POW': if (args.length !== 2 || Math.abs(args[1]) > 10) throw new Error('invalid_formula'); value = args[0] ** args[1]; break
        default: throw new Error('invalid_formula')
      }
      if (!Number.isFinite(value)) throw new Error('invalid_formula')
      return value
    }

    if (name === 'PI') return Math.PI
    if (name === 'E') return Math.E
    const value = this.variables.get(name)
    if (value === undefined) throw new Error('unknown_formula_variable')
    return value
  }

  private functionArguments(): number[] {
    this.position += 1
    this.tick()
    this.enterNesting()
    try {
      const args = [this.expression()]
      this.skipSpaces()
      while (this.source[this.position] === ',') {
        this.position += 1
        this.tick()
        args.push(this.expression())
        if (args.length > 2) throw new Error('invalid_formula')
        this.skipSpaces()
      }
      if (this.source[this.position] !== ')') throw new Error('invalid_formula')
      this.position += 1
      this.tick()
      return args
    } finally {
      this.nesting -= 1
    }
  }

  private skipSpaces(): void {
    while (/\s/.test(this.source[this.position] ?? '')) this.position += 1
  }

  private tick(): void {
    this.steps += 1
    if (this.steps > 100) throw new Error('formula_too_complex')
  }

  private enterNesting(): void {
    this.nesting += 1
    if (this.nesting > 24) throw new Error('formula_too_complex')
  }
}

function calculateBase(record: Record<string, unknown>, common: NonNullable<ReturnType<typeof normalizeCommon>>): {
  calculation: EstimateCalculationInput
  base: number
} | null {
  const mode = getString(record, 'mode')
  const baseFields = { repetitions: common.repetitionsText, wastePercent: common.wasteText }

  const measure = (key: string, allowZero = false): { text: string; number: number } | null =>
    normalizeDecimal(record[key], allowZero)

  switch (mode) {
    case 'manual': {
      const quantity = measure('quantity', false)
      return quantity ? { calculation: { mode, ...baseFields, quantity: quantity.text }, base: quantity.number } : null
    }
    case 'length': {
      const length = measure('length', false)
      return length ? { calculation: { mode, ...baseFields, length: length.text }, base: length.number } : null
    }
    case 'area':
    case 'perimeter': {
      const length = measure('length', false)
      const width = measure('width', false)
      if (!length || !width) return null
      const base = mode === 'area' ? length.number * width.number : 2 * (length.number + width.number)
      return { calculation: { mode, ...baseFields, length: length.text, width: width.text }, base }
    }
    case 'volume': {
      const length = measure('length', false)
      const width = measure('width', false)
      const height = measure('height', false)
      if (!length || !width || !height) return null
      return {
        calculation: { mode, ...baseFields, length: length.text, width: width.text, height: height.text },
        base: length.number * width.number * height.number,
      }
    }
    case 'circle_area':
    case 'circle_circumference':
    case 'cylinder_volume': {
      const radius = measure('radius', false)
      if (!radius) return null
      if (mode === 'circle_area') {
        return { calculation: { mode, ...baseFields, radius: radius.text }, base: Math.PI * radius.number ** 2 }
      }
      if (mode === 'circle_circumference') {
        return { calculation: { mode, ...baseFields, radius: radius.text }, base: 2 * Math.PI * radius.number }
      }
      const height = measure('height', false)
      if (!height) return null
      return {
        calculation: { mode, ...baseFields, radius: radius.text, height: height.text },
        base: Math.PI * radius.number ** 2 * height.number,
      }
    }
    case 'triangle_area': {
      const baseLength = measure('base', false)
      const height = measure('height', false)
      if (!baseLength || !height) return null
      return {
        calculation: { mode, ...baseFields, base: baseLength.text, height: height.text },
        base: (baseLength.number * height.number) / 2,
      }
    }
    case 'wall_area': {
      const wallValues = record.wallLengths
      if (!Array.isArray(wallValues) || wallValues.length < 1 || wallValues.length > 20) return null
      const wallLengths = wallValues.map((value) => normalizeDecimal(value, false))
      const height = measure('height', false)
      const openingsArea = measure('openingsArea', true)
      if (!height || !openingsArea || wallLengths.some((value) => value === null)) return null
      const lengths = wallLengths as { text: string; number: number }[]
      const area = lengths.reduce((sum, value) => sum + value.number, 0) * height.number - openingsArea.number
      if (area <= 0) return null
      return {
        calculation: {
          mode,
          ...baseFields,
          wallLengths: lengths.map((value) => value.text),
          height: height.text,
          openingsArea: openingsArea.text,
        },
        base: area,
      }
    }
    case 'formula': {
      const expression = getString(record, 'expression')
      const variablesValue = record.variables
      if (!expression || expression.length > 200 || !Array.isArray(variablesValue) || variablesValue.length > 10) return null
      const variables = new Map<string, number>()
      const normalizedVariables: { name: string; value: string }[] = []
      for (const value of variablesValue) {
        const variable = getRecord(value)
        const rawName = variable ? getString(variable, 'name') : null
        const rawValue = variable ? normalizeDecimal(variable.value, true) : null
        if (!rawName || !/^[A-Za-z][A-Za-z0-9_]{0,7}$/.test(rawName) || !rawValue) return null
        const name = rawName.toUpperCase()
        if (variables.has(name) || reservedFormulaNames.has(name)) return null
        variables.set(name, rawValue.number)
        normalizedVariables.push({ name, value: rawValue.text })
      }

      let result: number
      try {
        result = new FormulaParser(expression, variables).parse()
      } catch {
        return null
      }
      return {
        calculation: { mode, ...baseFields, expression, variables: normalizedVariables },
        base: result,
      }
    }
    default:
      return null
  }
}

export function calculateEstimateQuantity(value: unknown): CalculatedQuantity | null {
  const record = getRecord(value)
  if (!record) return null
  const common = normalizeCommon(record)
  if (!common) return null
  const result = calculateBase(record, common)
  if (!result) return null

  const quantity = result.base * common.repetitions * (1 + common.wastePercent / 100)
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 9_999_999.999) return null
  const rounded = Math.round((quantity + Number.EPSILON) * 1_000) / 1_000
  if (rounded <= 0) return null

  return { calculation: result.calculation, quantity: rounded.toFixed(3) }
}
