import { createContext } from 'react'

export const ReportSaveFailure = createContext<(failure: string | undefined) => void>(() => {})
