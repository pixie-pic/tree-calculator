from flask import Flask, render_template, request, jsonify
import sqlite3
import os
from pathlib import Path

app = Flask(__name__)

from pathlib import Path
import os

# Check if the DB file exists
if not Path("database/trees.db").exists():
    print("Database not found. Running setup...")
    import database_builder
    
# Get the absolute path to the database file
BASE_DIR = Path(__file__).parent
DB_PATH = BASE_DIR / 'database' / 'trees.db'

# helps to query the database, the results can be either a tuple or a dictionary
def query_db(query, args=(), one=False, as_dict=True, db_path=None):
    if db_path is None:
        db_path = DB_PATH
        
    # Ensure the database directory exists
    db_path.parent.mkdir(parents=True, exist_ok=True)
    
    try:
        conn = sqlite3.connect(str(db_path))
        
        if as_dict:
            conn.row_factory = sqlite3.Row  

        cur = conn.cursor()
        cur.execute(query, args)
        results = cur.fetchall()
        conn.close()

        if one:
            result = results[0] if results else None
            return dict(result) if as_dict and result else result

        if as_dict:
            return [dict(row) for row in results]
        return results
        
    except sqlite3.Error as e:
        print(f"Database error: {e}")
        if 'conn' in locals():
            conn.close()
        return None if one else []

# Page Routes
@app.route('/')
def welcome():
    return render_template("welcome.html")

@app.route('/home')
def home():
    return render_template("home.html")

@app.route('/why')
def why():
    return render_template("why.html")

@app.route('/methodology')
def methodology():
    return render_template("methodology.html")

@app.route('/dataset')
def dataset():
    return render_template("dataset.html")

@app.route('/layout_carbon_tree')
def layout_carbon_tree():
    return render_template("layout_carbon_tree.html")

@app.route('/get-available-dates', methods=['GET'])
def get_available_dates():
    try:
        # Query the database for available dates
        available_dates = query_db(
            """SELECT DISTINCT date FROM country_emissions""",
            as_dict=True
        )

        # If no dates are found, return an empty list or appropriate message
        if not available_dates:
            return jsonify({"message": "No available dates found"}), 404

        # Extract dates and return them in the required format
        dates = [row['date'] for row in available_dates]
        return jsonify({"dates": dates})
    
    except Exception as e:
        print(f"Error fetching available dates: {str(e)}")
        return jsonify({"error": "An error occurred while fetching available dates"}), 500

@app.route('/get-countries-with-data', methods=['GET'])
def get_countries_with_data():
    try:
        # Query the database to get all countries that have data
        countries_result = query_db(
            """SELECT DISTINCT country_name FROM country_emissions""", 
            as_dict=True
        )

        if not countries_result:
            return jsonify({"message": "No countries found with data"}), 404

        # Extract the country names
        countries = [row['country_name'] for row in countries_result]
        return jsonify({"status": "success", "countries": countries}), 200
    
    except Exception as e:
        print(f"Error fetching countries with data: {str(e)}")
        return jsonify({"error": "An error occurred while fetching countries with data"}), 500

@app.route('/get-tree-data', methods=['POST'])
def get_tree_data():
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "No data provided"}), 400
            
        country = data.get('country')
        date_str = data.get('date')  # format: DD/MM/YYYY

        if not all([country, date_str]):
            return jsonify({"error": "Missing required parameters"}), 400

        # Convert date from DD/MM/YYYY to match database format
        try:
            day, month, year = date_str.split('/')
            # Format as DD/MM/YYYY (ensure leading zeros)
            formatted_date = f"{int(day):02d}/{int(month):02d}/{year}"
        except ValueError:
            return jsonify({"error": "Invalid date format. Expected DD/MM/YYYY"}), 400

        # Get carbon emissions for the country and date
        emissions_result = query_db(
            """SELECT carbon_emissions 
            FROM country_emissions 
            WHERE country_name = ? AND date = ?""",
            (country, formatted_date)
        )

        if not emissions_result:
            return jsonify({"message": f"No emissions data found for {country} on {formatted_date}"}), 404

        emissions_mt = emissions_result[0]['carbon_emissions']
        
        # Get the 3 most common distinct species in the country with carbon data
        trees_result = query_db(
            """
            WITH ranked_species AS (
                SELECT 
                    p.species_dominant AS species,
                    COUNT(*) AS plot_count,
                    ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC) AS rank
                FROM plots p
                JOIN countries c ON p.country_code = c.code
                WHERE c.name = ? AND p.species_dominant IS NOT NULL
                GROUP BY p.species_dominant
                ORDER BY plot_count DESC

            ),
            filtered_species AS (
                -- Ensure we only include species with biomass and carbon density data
                SELECT rs.species, rs.plot_count, rs.rank
                FROM ranked_species rs
                WHERE rs.species IN (SELECT DISTINCT species FROM species_biomass)
                  AND rs.species IN (SELECT DISTINCT species FROM carbon_density)
                  AND rs.rank <= 3
            )
            SELECT 
                fs.species,
                fs.plot_count,
                AVG(sb.biomass) AS avg_biomass,
                cd.density,
                (AVG(sb.biomass) * cd.density / 100.0) AS carbon_kg_per_tree
            FROM filtered_species fs
            JOIN species_biomass sb ON fs.species = sb.species
            JOIN carbon_density cd ON fs.species = cd.species
            GROUP BY fs.species, fs.plot_count, cd.density
            ORDER BY fs.rank
            LIMIT 3
            """,
            (country,)
        )

        # Flag to indicate if approximation is used
        is_approximation = False
        species_info = []
        
        if not trees_result or len(trees_result) == 0:
            is_approximation = True
            trees_result = query_db(
                """
                WITH most_common_species AS (
                    SELECT species_dominant, COUNT(*) as count
                    FROM plots
                    WHERE species_dominant IS NOT NULL
                    GROUP BY species_dominant
                    ORDER BY count DESC
                    LIMIT 3
                )
                SELECT 
                    mcs.species_dominant as species,
                    mcs.count as plot_count,
                    AVG(sb.biomass) as avg_biomass,
                    cd.density,
                    (AVG(sb.biomass) * cd.density / 100.0) as carbon_kg_per_tree
                FROM most_common_species mcs
                JOIN species_biomass sb ON mcs.species_dominant = sb.species
                JOIN carbon_density cd ON mcs.species_dominant = cd.species
                GROUP BY mcs.species_dominant, mcs.count, cd.density
                """
            )

        if is_approximation and trees_result:
            # Only use the single species for approximation
            trees_result = trees_result[:1]
        
        # Convert emissions from Mt to kg (1 Mt = 1,000,000,000 kg)
        emissions_kg = emissions_mt * 1000000000
        
        # Process each species separately to avoid duplication
        processed_species = set()
        
        # Calculate trees needed for each species
        for row in trees_result:
            species_name = row['species']
            
            # Skip if we've already processed this species
            if species_name in processed_species:
                continue
                
            processed_species.add(species_name)
            
            # Use scientific name as common name since we removed the vernacular names
            common_name = species_name
            
            # Debug print to check values
            print(f"Processing species: {species_name}")
            print(f"Row data: {row}")
            print(f"carbon_kg_per_tree type: {type(row['carbon_kg_per_tree'])}")
            print(f"avg_biomass: {row['avg_biomass']} (type: {type(row['avg_biomass'])})")
            print(f"density: {row['density']} (type: {type(row['density'])})")
            
            carbon_per_tree = row['carbon_kg_per_tree']
            print(f"carbon_per_tree: {carbon_per_tree} (type: {type(carbon_per_tree)})")

            if carbon_per_tree is not None and carbon_per_tree > 0:
                trees_needed_for_species = int(emissions_kg / carbon_per_tree) + 1
            else:
                trees_needed_for_species = float('inf')  

            species_info.append({
                'species': common_name,
                'scientific_name': species_name,
                'plot_count': row['plot_count'],
                'avg_biomass_kg': row['avg_biomass'],
                'carbon_density': row['density'],
                'carbon_kg_per_tree': carbon_per_tree,
                'trees_needed': trees_needed_for_species
            })
        
        # Calculate weighted average for backward compatibility
        if species_info:
            total_weighted_carbon = sum(
                (row['plot_count'] / sum(s['plot_count'] for s in species_info)) * row['carbon_kg_per_tree']
                for row in species_info
            )
            trees_needed = int(emissions_kg / total_weighted_carbon) + 1 if total_weighted_carbon > 0 else float('inf')
        else:
            total_weighted_carbon = 0
            trees_needed = float('inf')
        
        return jsonify({
            "carbon_emissions_mt": emissions_mt,
            "avg_carbon_kg_per_tree": total_weighted_carbon,
            "trees_needed": trees_needed,
            "species_info": species_info,
            "is_approximation": is_approximation
        })
            
    except Exception as e:
        print(f"Error in get_tree_data: {str(e)}")
        return jsonify({"error": "An error occurred while processing your request"}), 500

if __name__ == '__main__':
    app.run(debug=False)
