import sqlite3
import pandas as pd
from pathlib import Path

# Initialize database
db_path = Path('database/trees.db')
db_path.parent.mkdir(exist_ok=True)
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

def clean_species(df, col):
            df.loc[:, col] = df[col].str.replace('_', ' ').str.title().str.strip().str.split().str[:2].str.join(' ')
            df = df.rename(columns={col: 'species'})
            return df
        

# DATABASE tables
cursor.executescript('''
-- Countries
CREATE TABLE IF NOT EXISTS countries (
    name TEXT UNIQUE NOT NULL,
    code TEXT PRIMARY KEY UNIQUE NOT NULL
);

-- Plots
CREATE TABLE IF NOT EXISTS plots (
    plot_id INTEGER PRIMARY KEY,
    species_dominant TEXT,
    country_code INTEGER NOT NULL,
    FOREIGN KEY (country_code) REFERENCES countries(code)
);

-- Species biomass
CREATE TABLE IF NOT EXISTS species_biomass (
    tree_id INTEGER PRIMARY KEY AUTOINCREMENT,
    plot_id INTEGER NOT NULL,
    species TEXT,
    biomass REAL,
    age INTEGER,
    FOREIGN KEY (plot_id) REFERENCES plots(plot_id),
    FOREIGN KEY (species) REFERENCES carbon_density(species)
);

-- Carbon density data
CREATE TABLE IF NOT EXISTS carbon_density (
    species TEXT PRIMARY KEY,
    density REAL NOT NULL
);

-- Country carbon emissions
CREATE TABLE IF NOT EXISTS country_emissions (
    country_name TEXT NOT NULL,
    date TEXT NOT NULL,
    carbon_emissions REAL,
    FOREIGN KEY (country_name) REFERENCES countries(name),
    PRIMARY KEY (country_name, date)
);
                     
DELETE FROM species_biomass
WHERE tree_id NOT IN (
    SELECT tree_id FROM (
        SELECT sb.tree_id,
               ROW_NUMBER() OVER (
                   PARTITION BY p.country_code, sb.species
                   ORDER BY sb.age DESC
               ) AS rn
        FROM species_biomass sb
        JOIN plots p ON sb.plot_id = p.plot_id
    )
    WHERE rn = 1
);
                     
''')


# DATA LOADING

# 1. Load countries from plot data
countries_df = pd.read_csv(r'data\wikipedia-iso-country-codes.csv')
# Drop rows with missing data and get unique combinations
countries = countries_df[['English short name lower case', 'Alpha-3 code']].dropna().drop_duplicates().itertuples(index=False, name=None)

# Insert into the database
cursor.executemany(
    'INSERT OR IGNORE INTO countries (name, code) VALUES (?, ?)',
    countries
)

# 3. Load plots
plot_df = pd.read_excel(r'data\Biomass_plot_DB.xlsx')
plot_df = clean_species(plot_df[['ID', 'Tree species', 'Country']], 'Tree species')
plot_df = plot_df.dropna(subset = ['ID', 'species'])
plot_data = list(plot_df.itertuples(index=False, name=None))

cursor.executemany(
    '''
    INSERT OR IGNORE INTO plots (plot_id, species_dominant, country_code)
    VALUES (?, ?, ?)
    ''',
    plot_data
)

# 4. Load biomass
biomass_df = pd.read_excel(r'data\Biomass_tree_DB.xlsx')
biomass_df = biomass_df.dropna(subset=['Species', 'Ptot'])
biomass_df = clean_species(biomass_df[['ID_Plot', 'Species', 'Ptot', 'Tree age']], 'Species')
biomass_data = list(biomass_df.itertuples(index=False, name=None))

cursor.executemany(
    '''
    INSERT OR IGNORE INTO species_biomass (plot_id, species, biomass, age)
    VALUES (?, ?, ?, ?)
    ''',
    biomass_data
)

# 5. Load density
density_df = pd.read_csv(r'data\Doraisami_et_al._2021_Wood_C_Database.csv', encoding = 'unicode_escape', usecols = [ 'binomial.resolved', 'tissue.c'])
density_df = density_df.groupby('binomial.resolved')['tissue.c'].mean().reset_index()
density_df = clean_species(density_df, 'binomial.resolved')
density_df.columns = ['species', 'carbon_density']
density_df = density_df.dropna(subset=['species', 'carbon_density'])
density_data = list(density_df.itertuples(index=False, name=None))

cursor.executemany(
    '''
    INSERT OR IGNORE INTO carbon_density (species, density)
    VALUES (?, ?)
    ''',
    density_data
)

# 6. Load carbon emissions data
emissions_df = pd.read_excel(r'data\carbon-monitor-EU-maingraphdatas.xlsx')

emissions_df['date'] = pd.to_datetime(emissions_df['date'], format='%d/%m/%Y')

# Group and clean
emissions_df = emissions_df.groupby(['country', 'date'], as_index=False)['MtCO2 per day'].sum()
emissions_df = emissions_df[['country', 'date', 'MtCO2 per day']].rename(columns={'MtCO2 per day': 'carbon_emissions'})

emissions_df['date'] = emissions_df['date'].dt.strftime('%d/%m/%Y')
emissions_df = emissions_df.dropna()

# Convert to list of tuples
emissions_data = list(emissions_df.itertuples(index=False, name=None))

# Insert into database
cursor.executemany(
    '''
    INSERT OR IGNORE INTO country_emissions (country_name, date, carbon_emissions)
    VALUES (?, ?, ?)
    ''',
    emissions_data
)


# FINALIZE
conn.commit()
conn.close()
