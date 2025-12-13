import type { NextApiRequest, NextApiResponse } from 'next';
import { getLogStore } from '../../../logs/store';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const { limit = '100', filter = '' } = req.query;
  const limitNum = Math.min(parseInt(limit as string, 10) || 100, 1000);
  const filterStr = (filter as string).toLowerCase();

  let logs = getLogStore().getLogs(limitNum);

  if (filterStr) {
    logs = logs.filter(log =>
      log.message.toLowerCase().includes(filterStr) ||
      log.source.toLowerCase().includes(filterStr) ||
      log.level.toLowerCase().includes(filterStr)
    );
  }

  res.status(200).json({ logs, total: logs.length });
}
