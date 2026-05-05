// CountryProfileTable.tsx
// Filterable, sortable table of all 22 country profiles.
// React island, hydrated on mount via Astro client:load.
// No external libraries beyond React. Tailwind for styles.
//
// Conservative Navy palette matching ghspictograms.com (#0077B6 primary).

import { useState, useMemo } from 'react';

interface CountryProfile {
  country: string;
  region: 'North America' | 'EU & UK' | 'Asia-Pacific' | 'Latin America' | 'MENA & Africa';
  regulation: string;
  authority: string;
  ghsRevision: string;
  anchorId: string;
}

const profiles: CountryProfile[] = [
  // North America
  { country: 'United States', region: 'North America', regulation: 'OSHA HCS 2024 (29 CFR 1910.1200)', authority: 'OSHA', ghsRevision: 'Rev 7', anchorId: 'united-states-osha-hcs-2024' },
  { country: 'Canada', region: 'North America', regulation: 'WHMIS 2015 / HPR', authority: 'Health Canada', ghsRevision: 'Rev 7', anchorId: 'canada-whmis-2015' },

  // EU & UK
  { country: 'European Union', region: 'EU & UK', regulation: 'CLP Regulation (EC) 1272/2008', authority: 'ECHA', ghsRevision: 'Rev 7 + ATPs', anchorId: 'european-union-clp-regulation' },
  { country: 'United Kingdom', region: 'EU & UK', regulation: 'GB CLP', authority: 'HSE', ghsRevision: 'Rev 7', anchorId: 'united-kingdom-gb-clp' },
  { country: 'Switzerland', region: 'EU & UK', regulation: 'Chemicals Ordinance (ChemO)', authority: 'FOPH', ghsRevision: 'Rev 7', anchorId: 'switzerland' },

  // Asia-Pacific
  { country: 'China', region: 'Asia-Pacific', regulation: 'GB 30000.1-2024 + 30000.2-29', authority: 'MIIT / MEM / MEE / SAMR', ghsRevision: 'Rev 8 / 4', anchorId: 'china-gb-30000-series' },
  { country: 'Japan', region: 'Asia-Pacific', regulation: 'JIS Z 7252 / JIS Z 7253; ISHL', authority: 'MHLW / METI / MOE / NITE', ghsRevision: 'Rev 6', anchorId: 'japan-jis-z-7252-and-jis-z-7253' },
  { country: 'South Korea', region: 'Asia-Pacific', regulation: 'K-OSHA Notice; K-REACH', authority: 'MoEL / Ministry of Environment', ghsRevision: 'Rev 7', anchorId: 'south-korea' },
  { country: 'Indonesia', region: 'Asia-Pacific', regulation: 'KEMENAKER Reg 187/1999; Permenperin 23/2013', authority: 'KEMENAKER / Ministry of Industry', ghsRevision: 'Rev 4', anchorId: 'indonesia' },
  { country: 'Australia', region: 'Asia-Pacific', regulation: 'Model WHS Regulations', authority: 'Safe Work Australia', ghsRevision: 'Rev 7', anchorId: 'australia-and-new-zealand' },
  { country: 'New Zealand', region: 'Asia-Pacific', regulation: 'HSNO Act / Hazardous Substances Regs', authority: 'EPA NZ / WorkSafe NZ', ghsRevision: 'Rev 7', anchorId: 'australia-and-new-zealand' },
  { country: 'Philippines', region: 'Asia-Pacific', regulation: 'DAO 2009-08; CCO', authority: 'DENR / EMB', ghsRevision: 'Rev 4', anchorId: 'philippines' },
  { country: 'Thailand', region: 'Asia-Pacific', regulation: 'Hazardous Substance Act', authority: 'DIW / FDA / DOA', ghsRevision: 'Rev 5', anchorId: 'thailand' },
  { country: 'Malaysia', region: 'Asia-Pacific', regulation: 'CLASS Regulations 2013', authority: 'DOSH', ghsRevision: 'Rev 3', anchorId: 'malaysia' },
  { country: 'Vietnam', region: 'Asia-Pacific', regulation: 'Decree 113/2017; Law 69/2025/QH15', authority: 'MoIT', ghsRevision: 'Rev 2', anchorId: 'vietnam' },
  { country: 'India', region: 'Asia-Pacific', regulation: 'MSIHC Rules; Chemicals (Mgmt) Rules (draft)', authority: 'MoEFCC', ghsRevision: 'Voluntary', anchorId: 'india' },

  // Latin America
  { country: 'Brazil', region: 'Latin America', regulation: 'ABNT NBR 14725:2023', authority: 'ABNT / ANVISA / IBAMA', ghsRevision: 'Rev 7', anchorId: 'brazil' },
  { country: 'Mexico', region: 'Latin America', regulation: 'NOM-018-STPS-2015', authority: 'STPS', ghsRevision: 'Rev 5', anchorId: 'mexico' },
  { country: 'Argentina / Chile / Peru', region: 'Latin America', regulation: 'UN GHS direct adoption', authority: 'Various', ghsRevision: 'Rev 6-7', anchorId: 'argentina-chile-peru' },

  // MENA & Africa
  { country: 'GCC Region', region: 'MENA & Africa', regulation: 'GSO 2654:2021/2025', authority: 'GCC Standardization Organization', ghsRevision: 'Rev 10', anchorId: 'gcc-region' },
  { country: 'Türkiye', region: 'MENA & Africa', regulation: 'SEA Yönetmeliği; KKDIK', authority: 'MoEUCC', ghsRevision: 'Rev 7', anchorId: 'turkiye' },
  { country: 'South Africa', region: 'MENA & Africa', regulation: 'OHSA HCS Regulations; SANS 10234', authority: 'Department of Employment and Labour', ghsRevision: 'Rev 7 (in transition)', anchorId: 'south-africa' },
];

const regions: CountryProfile['region'][] = [
  'North America',
  'EU & UK',
  'Asia-Pacific',
  'Latin America',
  'MENA & Africa',
];

type SortKey = 'country' | 'region' | 'ghsRevision';

export default function CountryProfileTable() {
  const [filter, setFilter] = useState('');
  const [activeRegion, setActiveRegion] = useState<CountryProfile['region'] | 'All'>('All');
  const [sortKey, setSortKey] = useState<SortKey>('region');
  const [sortAsc, setSortAsc] = useState(true);

  const filtered = useMemo(() => {
    let result = profiles;

    if (activeRegion !== 'All') {
      result = result.filter((p) => p.region === activeRegion);
    }

    if (filter.trim()) {
      const q = filter.toLowerCase().trim();
      result = result.filter(
        (p) =>
          p.country.toLowerCase().includes(q) ||
          p.regulation.toLowerCase().includes(q) ||
          p.authority.toLowerCase().includes(q),
      );
    }

    return [...result].sort((a, b) => {
      const av = a[sortKey].toLowerCase();
      const bv = b[sortKey].toLowerCase();
      if (av < bv) return sortAsc ? -1 : 1;
      if (av > bv) return sortAsc ? 1 : -1;
      return 0;
    });
  }, [filter, activeRegion, sortKey, sortAsc]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  return (
    <div className="my-8 rounded-lg border border-slate-200 bg-white p-4 sm:p-6 shadow-sm">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setActiveRegion('All')}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
              activeRegion === 'All'
                ? 'bg-[#0077B6] text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            All ({profiles.length})
          </button>
          {regions.map((r) => {
            const count = profiles.filter((p) => p.region === r).length;
            return (
              <button
                key={r}
                onClick={() => setActiveRegion(r)}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                  activeRegion === r
                    ? 'bg-[#0077B6] text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {r} ({count})
              </button>
            );
          })}
        </div>

        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search country, regulation, authority…"
          className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm placeholder-slate-400 focus:border-[#0077B6] focus:outline-none focus:ring-1 focus:ring-[#0077B6] sm:w-64"
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b-2 border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <th
                onClick={() => handleSort('country')}
                className="cursor-pointer select-none py-2 pr-3 hover:text-[#0077B6]"
              >
                Country {sortKey === 'country' && (sortAsc ? '↑' : '↓')}
              </th>
              <th
                onClick={() => handleSort('region')}
                className="cursor-pointer select-none py-2 pr-3 hover:text-[#0077B6]"
              >
                Region {sortKey === 'region' && (sortAsc ? '↑' : '↓')}
              </th>
              <th className="py-2 pr-3">Regulation</th>
              <th className="py-2 pr-3">Authority</th>
              <th
                onClick={() => handleSort('ghsRevision')}
                className="cursor-pointer select-none py-2 pr-3 hover:text-[#0077B6]"
              >
                Aligned {sortKey === 'ghsRevision' && (sortAsc ? '↑' : '↓')}
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr
                key={p.country}
                className="border-b border-slate-100 hover:bg-slate-50"
              >
                <td className="py-2 pr-3 font-medium text-slate-900">
                  <a
                    href={`#${p.anchorId}`}
                    className="text-[#0077B6] hover:underline"
                  >
                    {p.country}
                  </a>
                </td>
                <td className="py-2 pr-3 text-slate-600">{p.region}</td>
                <td className="py-2 pr-3 text-slate-700">{p.regulation}</td>
                <td className="py-2 pr-3 text-slate-700">{p.authority}</td>
                <td className="py-2 pr-3 font-semibold text-slate-900">
                  {p.ghsRevision}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-sm text-slate-500">
                  No matching profiles. Try a different search or region.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs italic text-slate-500">
        Click a country name to jump to its full profile below. Tap a column header to sort.
      </p>
    </div>
  );
}
