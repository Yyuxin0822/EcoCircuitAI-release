from flaskr.ecocircuit.method import Task
from pydantic import BaseModel
from typing import List
import asyncio
import re
import logging


class Input(BaseModel):
    system: str
    input: List[str]


class InputList(BaseModel):
    inputlist: List[Input]

    def __iter__(self):
        return iter(self.inputlist)


class IO(BaseModel):
    input: str
    output: str


class IOList(BaseModel):
    iolist: List[IO]

    def __iter__(self):
        return iter(self.io)


class IOTask(Task):
    task_message = "Generating system inputs and outputs ..."
    def __init__(self, clientasync=None, usage_tracker=None):
        super().__init__(clientasync, usage_tracker)
        self.name = "io"

    async def gen_output(self, data):
        n = 15

        if data.get("iso_syslist"):
            newsys_input = await self.geninput(data["env"], data["iso_syslist"])
            newsys_input = [
                i for input in newsys_input.inputlist for i in input.input
            ]
            if data.get("iso_input"):
                data["iso_input"].extend(newsys_input)
            else:
                data["iso_input"] = newsys_input

        if data.get("io"):
            if self.output:
                self.output.iolist.extend(data["io"].iolist)
            else:
                self.output = data["io"]

        is_iso_input = bool(data.get("iso_input") and data.get("syslist"))
        is_iso_output = bool(data.get("iso_output") and data.get("syslist"))
        is_env = bool(
            data.get("env")
            and data.get("syslist")
            and not data.get("iso_input")
            and not data.get("iso_output")
        )

        if is_iso_output:
            output_resources = data["iso_output"]
            nested_outputs = [
                output_resources[i : i + n] for i in range(0, len(output_resources), n)
            ]
            tasks = [
                self.genaddinput(outputlist, data["syslist"], data["env"])
                for outputlist in nested_outputs
            ]
            results = await asyncio.gather(*tasks)
            if self.output is not None:
                self.output.iolist.extend(
                    [io for result in results for io in result.iolist]
                )
            else:
                self.output = IOList(
                    iolist=[io for result in results for io in result.iolist]
                )
            if not is_iso_input:
                return self

        if is_iso_input or is_env:
            if is_iso_input:
                input_resources = data["iso_input"]
            else:  # is_env case
                self.input = await self.geninput(data["env"], data["syslist"])
                input_resources = [
                    i for input in self.input.inputlist for i in input.input
                ]

            print(f"Here are the inputs: {input_resources}")

            nested_inputs = [
                input_resources[i : i + n] for i in range(0, len(input_resources), n)
            ]
            tasks = [
                self.genaddoutput(inputlist, data["syslist"], data["env"])
                for inputlist in nested_inputs
            ]
            results = await asyncio.gather(*tasks)
            if self.output is not None:
                self.output.iolist.extend(
                    [io for result in results for io in result.iolist]
                )
            else:
                self.output = IOList(
                    iolist=[io for result in results for io in result.iolist]
                )

            if is_env:
                iopairs = [
                    f"input:{pair.input}, output:{pair.output}"
                    for pair in self.output.iolist
                ]

                n2 = max(15, len(data["syslist"]) * 5)
                self.output = await self.eval_io(
                    data["env"], iopairs, syslist=data["syslist"], number=n2
                )

        data.pop("iso_input", None)
        data.pop("iso_output", None)
        data.pop("iso_syslist", None)
        return self


    def parse_output(self):
        self.parsed_output = self.output
        return self

    def test_output(self):
        return True

    async def geninput(self, envir_description: str, syslist: list):
        """return unique input from environment description"""
        if not syslist or not envir_description:
            return None
        response = await self.completion(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": f"You will extract and imagine potential resources in the environment description of various systems as keywords. \
The resources include potential components, objects, materials, organisms, and even chemicals. \
Please ensure a minimum of five resources for each system provided and don't have too many in one system. The more system provided, the more total resources you generate. \
Please be as specific as possible and avoid generics.  Be as specific to the environment provided as possible.\
Focus on terms that could land on actionable things - 'rainwater harvesting cisterns', 'Honeybee colonies', 'Rooftop solar photovoltaic panels', \"Community-run Farmers' Market Pavilion\", 'Historic district cultural walk'",
                },
                {
                    "role": "user",
                    "content": f'environment: "This scene depicts an agricultural village in the mountains. There are a couple flood valleys with turbulent water. \
                                                To empower this village, there are some windfarms nearby. Cheetahs in the mountains need to be preserved. \
                                                Food and potable water can be very valuable here."\
                                system: ["ecosystem", "hydro", "energy"]',
                },
                {
                    "role": "assistant",
                    "content": f'[["ecosystem":["Crops", "Soil", "Cheetahs", "Mountain terrain", "Wildlife", "Rocks", "Seeds", "Fertilizers", "Herbal plants", "Berries", "Clay", "Sand", "Compost", "Pollinators", "Fungi", "Earthworms"]]\
                    ["hydro":["Fresh Water", "Flood valleys", "Turbulent water", "Irrigation systems", "Streams", "Natural springs", "Aquifers", "Rainwater", "Vadose wells", "Potable water"]]\
                    ["energy":["Wind", "Wind turbines", "Sunlight", "Solar panels", "Firewood", "Timber"]]]',
                },
                {
                    "role": "user",
                    "content": f"environment: 'This is an urban plaza with tech events and livehouse.' \
                                system: [food, economy, mobility]",
                },
                {
                    "role": "assistant",
                    "content": f'[["food":["Food trucks","Local cuisine","Food stalls","Fresh produce","Spices","Seasonings","Beverages","Desserts","Street food","Food vendors","Food festivals","Urban farms"]],\
                    ["economy":["Tech events","Livehouse","Local markets","Artisan crafts","Cultural shops","Smart kiosks","Handmade goods","Organic produce","Locally sourced materials", "Amphitheaters"]],\
                    ["mobility":["Bicycles","Scooters","Electric vehicles","Pedestrian walkways","Public transportation","Bike lanes","Car-sharing services","Ride-hailing services"]]]',
                },
                {
                    "role": "user",
                    "content": f"environment: 'This area displays a lush mangrove forest, where roots dive deep into the brackish waters. Brightly colored crabs scuttle about, and the chirping of unseen insects is constant. Fishermen navigate through channels casting nets in a dance as old as time.' \
                                system: '[food, economy, mobility]'",
                },
                {
                    "role": "assistant",
                    "content": f'[["food":["Crabs", "Fish", "Shrimp", "Mussels", "Seaweed", "Local Cuisine", "Lobsters"]], \
                            ["economy":["Eco-tourism initiative", "Kayak and canoe rentals", "Aquaculture", "Piers and docks improvement", "Mangrove research center", "Seasonal fishing training", "Bait Nets", "Fishermen"]],\
                            ["mobility":["Boats", "Canoes", "Ferryboats", "Sails", "Paddles"]]]',
                },
                {
                    "role": "user",
                    "content": f"environment: 'This is a biophilic boulevard for monarch and Latinos.' \
                                system: '[biosystem, economy, community]'",
                },
                {
                    "role": "assistant",
                    "content": f'[["biosystem":["Monarch butterflies", "Milkweeds", "Shrubs", "Flowers", "Pollinators", "Soil", "Sunshine", "Rainwater", "Mulch", "Compost", "Fallen leaves", "Garden beds", "Fresh herbs"]],\
    ["economy":["Artisan crafts", "Food vendors", "Local markets", "Cultural shops", "Artwork", "Handmade goods", "Organic produce", "Locally sourced materials"]],\
    ["community":["Community gardens", "Latino festivals", "Murals", "Gathering spaces", "Play areas", "Affordable Housing", "Parklets for community", "Latino crafts", "Conservation awareness", "Latin American art"]]\
]',
                },
                {
                    "role": "user",
                    "content": f"environment:'{envir_description}',\
                                system:'{syslist}'",
                },
            ],
            response_format=InputList,
            temperature=1,
            max_tokens=1800,
            top_p=1,
            frequency_penalty=0,
            presence_penalty=0,
            n=Task.randomNumber,
        )
        return response.choices[0].message.parsed

    async def genaddoutput(self, input, syslist: list, env: str) -> list:
        """return unique output from input and system provided"""
        response = await self.completion(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": [
                        {
                            "type": "text",
                            "text": 'You are an encyclopedia. Given the input list, please come up with output resources based on provided systems and environments \
                            Please make sure you thought about every input and every system. \
                            If there are over 15 inputs, generate one or two outputs for each input. Make sure you have at least 5 different output for different systems.\
                            Please generate around 45 input-output pairs in total. \
                            Please avoid generic sustainability goals and similar meaning outputs. \
                            Check all outputs, and if you come up with "crop yield protection", "crop yield improvement", they are similar meaning, just keep one.\
                            Please return them in this format: [["input1", "output1"], ["input2", "output2"],...]  ',
                        }
                    ],
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": 'input: ["waste water", "organic waste", "wind"], \
                            system:["HYDRO", "ENERGY", "ECOSYSTEM"], \
                            environment:"mountain"',
                        }
                    ],
                },
                {
                    "role": "assistant",
                    "content": [
                        {
                            "type": "text",
                            "text": '[["WASTE WATER", "RENEWABLE ENERGY PRODUCTION"],\n["WASTE WATER", "MICROBIAL FUEL CELLS"],\n["WASTE WATER", "NUTRIENT EXTRACTION FOR AGRICULTURE"],\n["WASTE WATER", "SAFE DRINKING WATER"],\n["WASTE WATER", "INDUSTRIAL COOLING PROCESSES"],\n["WASTE WATER", "BIOGAS GENERATION"],\n["ORGANIC WASTE", "NUTRIENT EXTRACTION FOR AGRICULTURE"],\n["ORGANIC WASTE", "METHANE CAPTURE AND UTILIZATION"],\n["ORGANIC WASTE", "ORGANIC FERTILIZER"],\n[ORGANIC WASTE, ANAEROBIC DIGESTION],\n["ORGANIC WASTE", "BIOGAS GENERATION"],\n["WIND","HYDROGEN"],\n["WIND","STORED IN BATTERIES"],\n["WIND", "SUSTAINABLE HYDROPOWER INTEGRATION"],\n["WIND", "HUMIDITY"],\n["WIND", "RENEWABLE ENERGY PRODUCTION"]]',
                        }
                    ],
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": 'input: ["biofuel", "wifi"], system:["ENERGY", "ECOSYSTEM", "TELECOMMUNICATION"], environment:"urban"',
                        }
                    ],
                },
                {
                    "role": "assistant",
                    "content": [
                        {
                            "type": "text",
                            "text": '[["BIOFUEL", "REDUCTION OF GREENHOUSE GASES"], ["BIOFUEL", "BIODEGRADABLE BYPRODUCTS"], ["BIOFUEL", "SUPPORT FOR RURAL ECONOMIES"], ["BIOFUEL", "GENERATION OF INDUSTRIAL HEAT"], ["WIFI", "SMART GRID MANAGEMENT"], ["WIFI", "REMOTE AGRICULTURAL MONITORING"], ["WIFI", "WILDLIFE TRACKING"], ["WIFI", "ENHANCED TELECOMMUNICATION INFRASTRUCTURE"], ["WIFI", "REMOTE ENVIRONMENTAL SENSING"]]',
                        }
                    ],
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": 'input: ["CONTROLLED DRAINAGE SYSTEMS", "POTABLE WATER", "RECLAIMED WATER SYSTEMS", \n"STORMWATER MANAGEMENT SYSTEMS", "WATER TANKS", "HERB GARDENS", "ROOFTOP GARDENS", "SHRUBS", "URBAN WILDLIFE","VERTICAL GARDENS","AIR QUALITY SENSORS","METAL FRAMES", "SENSORS", "TECHNICAL MONITORING SYSTEMS","BIO-WASTE DIGESTERS","COMPOST BINS", "FIBER OPTIC CABLES","SIGNAL BOOSTERS",  "ELECTRIC VEHICLE CHARGING STATIONS", \n"PEDESTRIAN PATHWAYS", "PUBLIC TRANSPORT ACCESS", "BUILDING INSULATION", "PHOTOVOLTAIC GLASS", "SOLAR PANELS"], system: ["HYDRO", "ENERGY", "BIOSYSTEM", "TELECOMMUNICATION", "UNKNOWN", "MOBILITY", "SOLID WASTE"]',
                        }
                    ],
                },
                {
                    "role": "assistant",
                    "content": [
                        {
                            "type": "text",
                            "text": '[["CONTROLLED DRAINAGE SYSTEMS", "ENHANCED CROP YIELD THROUGH OPTIMAL SOIL MOISTURE CONTROL"], ["CONTROLLED DRAINAGE SYSTEMS", "MINIMIZED EUTROPHICATION"], ["CONTROLLED DRAINAGE SYSTEMS", "ADAPTIVE FLOOD MITIGATION"], ["CONTROLLED DRAINAGE SYSTEMS", "AQUIFER RECHARGE"],\n["POTABLE WATER", "SAFE DRINKING WATER THROUGH FILTRATION"], ["POTABLE WATER", "INDUSTRIAL PROCESS WATER"], ["POTABLE WATER", "EMERGENCY RESERVES"], ["POTABLE WATER", "MEDICAL USAGE"],\n["RECLAIMED WATER SYSTEMS", "AGRICULTURAL IRRIGATION WATER"], ["RECLAIMED WATER SYSTEMS", "COST-EFFECTIVE WATER REUSE FOR COOLING"], ["RECLAIMED WATER SYSTEMS", "WETLAND RESTORATION"],\n["STORMWATER MANAGEMENT SYSTEMS", "ADAPTIVE FLOOD MITIGATION"], ["STORMWATER MANAGEMENT SYSTEMS", "AQUIFER RECHARGE"], ["STORMWATER MANAGEMENT SYSTEMS", "NON-POTABLE APPLICATIONS"],\n["WATER TANKS", "EMERGENCY WATER SUPPLY STORAGE"], ["WATER TANKS", "RAINWATER HARVESTING"], ["WATER TANKS", "FIRE SUPPRESSION RESERVES"], ["WATER TANKS", "AGRICULTURAL IRRIGATION"],\n["HERB GARDENS", "URBAN GREENING"], ["HERB GARDENS", "COMMUNITY HEALTH"], ["HERB GARDENS", "LOCAL FOOD PRODUCTION"], ["HERB GARDENS", "IMPROVED BIODIVERSITY"],\n["ROOFTOP GARDENS", "URBAN HEAT ISLAND EFFECT REDUCTION"], ["ROOFTOP GARDENS", "INSULATION FOR BUILDINGS"], ["ROOFTOP GARDENS", "IMPROVED BIODIVERSITY"], ["ROOFTOP GARDENS", "LOCAL FOOD PRODUCTION"],\n["SHRUBS", "EROSION CONTROL"], ["SHRUBS", "SHELTER AND FOOD FOR LOCAL WILDLIFE"], ["SHRUBS", "CARBON SEQUESTRATION"], ["SHRUBS", "AESTHETIC IMPROVEMENT"], ["URBAN WILDLIFE", "IMPROVED BIODIVERSITY"], ["URBAN WILDLIFE", "MAINTAINING PREDATOR-PREY DYNAMICS"], ["URBAN WILDLIFE", "LIVING LABORATORIES"], ["URBAN WILDLIFE", "RECREATION AND TOURISM"],\n["VERTICAL GARDENS", "URBAN HEAT ISLAND EFFECT REDUCTION"], ["VERTICAL GARDENS", "IMPROVED AIR QUALITY"], ["VERTICAL GARDENS", "BUILDING INSULATION"], ["VERTICAL GARDENS", "LOCAL FOOD PRODUCTION"], ["AIR QUALITY SENSORS", "REAL-TIME AIR POLLUTION MONITORING"],\n["AIR QUALITY SENSORS", "PUBLIC HEALTH DATA"], ["AIR QUALITY SENSORS", "ENVIRONMENTAL POLICY ENFORCEMENT"], ["AIR QUALITY SENSORS", "INDOOR AIR QUALITY MONITORING"],\n["METAL FRAMES", "DURABLE FRAMES FOR GREEN BUILDING"], ["METAL FRAMES", "SOLAR PANELS"], ["METAL FRAMES", "STRONG AND DURABLE CONSTRUCTION MATERIALS"],\n["SENSORS", "SMART IRRIGATION SYSTEMS"], ["SENSORS", "INFRASTRUCTURE HEALTH MONITORING"], ["SENSORS", "WILDLIFE TRACKING"], ["SENSORS", "REAL-TIME DATA COLLECTION FOR URBAN PLANNING"],\n["TECHNICAL MONITORING SYSTEMS", "INFRASTRUCTURE HEALTH MONITORING"], ["TECHNICAL MONITORING SYSTEMS", "ENERGY USAGE OPTIMIZATION"], ["TECHNICAL MONITORING SYSTEMS", "RESOURCE MANAGEMENT"],\n["BIO-WASTE DIGESTERS", "BIOGAS GENERATION"], ["BIO-WASTE DIGESTERS", "ORGANIC FERTILIZER PRODUCTION"], ["BIO-WASTE DIGESTERS", "WASTE VOLUME REDUCTION"], ["BIO-WASTE DIGESTERS", "REDUCED LANDFILL WASTE"],\n["COMPOST BINS", "SOIL ENRICHMENT"], ["COMPOST BINS", "DIVERTING ORGANIC WASTE FROM LANDFILLS"], ["COMPOST BINS", "ORGANIC FERTILIZER PRODUCTION"], ["COMPOST BINS", "SUPPORTING LOCAL GARDEN"], ["FIBER OPTIC CABLES", "HIGH-SPEED INTERNET CONNECTIVITY"], ["FIBER OPTIC CABLES", "RELIABLE DATA TRANSMISSION"], ["FIBER OPTIC CABLES", "ENHANCED TELECOMMUNICATION INFRASTRUCTURE"], ["FIBER OPTIC CABLES", "SUPPORT FOR SMART CITY APPLICATIONS"],\n["SIGNAL BOOSTERS", "IMPROVED CELLULAR CONNECTIVITY"], ["SIGNAL BOOSTERS", "ELIMINATING DEAD ZONES"], ["SIGNAL BOOSTERS", "REDUCED DROPPED CALLS"], ["SIGNAL BOOSTERS", "SUPPORT FOR REMOTE WORK AND TELECOMMUTING"], ["ELECTRIC VEHICLE CHARGING STATIONS", "SUPPORT FOR ELECTRIC VEHICLE ADOPTION"], ["ELECTRIC VEHICLE CHARGING STATIONS", "REDUCED GREENHOUSE GAS EMISSIONS"], ["ELECTRIC VEHICLE CHARGING STATIONS", "PROMOTE SUSTAINABLE TRANSPORTATION"], ["ELECTRIC VEHICLE CHARGING STATIONS", "REDUCED RELIANCE ON FOSSIL FUELS"], ["PEDESTRIAN PATHWAYS", "ENHANCED URBAN MOBILITY"], ["PEDESTRIAN PATHWAYS", "REDUCED TRAFFIC CONGESTION"], ["PEDESTRIAN PATHWAYS", "IMPROVED PUBLIC HEALTH"], ["PEDESTRIAN PATHWAYS", "INCREASED WALKABILITY"], ["PUBLIC TRANSPORT ACCESS", "REDUCED TRAFFIC CONGESTION"], ["PUBLIC TRANSPORT ACCESS", "LOWER CARBON FOOTPRINT"], ["PUBLIC TRANSPORT ACCESS", "ACCESSIBLE TRANSIT FOR ALL CITIZENS"], ["PUBLIC TRANSPORT ACCESS", "IMPROVED PUBLIC HEALTH"],\n["BUILDING INSULATION", "ENERGY CONSERVATION"], ["BUILDING INSULATION", "REDUCED HEATING AND COOLING COSTS"], ["BUILDING INSULATION", "IMPROVED INDOOR COMFORT"], ["BUILDING INSULATION", "REDUCED GREENHOUSE GAS EMISSIONS"], ["PHOTOVOLTAIC GLASS", "SOLAR ENERGY GENERATION"], ["PHOTOVOLTAIC GLASS", "BUILDING ENERGY EFFICIENCY"], ["PHOTOVOLTAIC GLASS", "REDUCED CARBON FOOTPRINT"], ["PHOTOVOLTAIC GLASS", "AESTHETIC ARCHITECTURAL DESIGN"], ["SOLAR PANELS", "DISTRIBUTED ENERGY"], ["SOLAR PANELS", "ENERGY COST SAVINGS"], ["SOLAR PANELS", "REDUCED GREENHOUSE GAS EMISSIONS"], ["SOLAR PANELS", "DECENTRALIZED POWER"]]\n ',
                        }
                    ],
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": f"input:{input}, system:{syslist}, environment:{env}",
                        }
                    ],
                },
            ],
            response_format=IOList,
            temperature=1,
            max_tokens=2048,
            top_p=1,
            frequency_penalty=0,
            presence_penalty=0,
            n=Task.randomNumber,
        )
        return response.choices[0].message.parsed

    async def genaddinput(self, output, syslist: list, env: str) -> list:
        """return input resources from output
        Args:
        output(list) -- the output resources
        system(list) -- the system info

        Returns:
        [[i1,o1],[i2,o2],...] -- a list of list of input and output
        """
        response = await self.completion(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": f"""You are an encyclopedia.Given the outputs, please come up with input resources from the systems I provided. \
                            These input-output pairs aim at resource co-optimization, net-zero environment, circular economy, etc. \
                            Please come up with three to five inputs for each output provided, and please make sure that you thought about every system and don't be generic. and return them in this format: [[input1, output1], [input2, output2],...]""",
                },
                {
                    "role": "user",
                    "content": 'output: ["irrigation water", "wind"], system:["HYDRO", "ENERGY", "ECOSYSTEM"], environment:"mountain"',
                },
                {
                    "role": "assistant",
                    "content": '[["rainwater harvesting", "irrigation water"],["reclaimed water", "irrigation water"],  ["river diversion and canal", "irrigation water"], ["solar-powered water pumps", "irrigation water"],  ["desalination plants powered by renewable energy", "irrigation water"], ["wastewater treatment and reuse", "irrigation water"],  ["smart irrigation systems", "irrigation water"], ["water storage", "irrigation water"], ["constructed Wetlands", "irrigation water"], ["agroforestry", "irrigation water"], ["wind turbine", "wind energy"], ["meteorological data",  "wind energy"], ["composting", "wind energy"]]',
                },
                {
                    "role": "user",
                    "content": 'output: ["biofuel", "wifi"], system:["ENERGY", "ECOSYSTEM", "TELECOMMUNICATION"], environment:"municipal farm"',
                },
                {
                    "role": "assistant",
                    "content": '[["municipal solid waste", "biofuel"], ["algae biomass", "biofuel"], ["crop residues", "biofuel"], ["animal fat", "biofuel"], ["atmospheric CO2", "biofuel"], ["digesters", "biofuel"], ["broadband infrastructure", "wifi"], ["fiber-optic networks", "wifi"],["antenna", "wifi"], ["satellite", "wifi"], ["regulated radio waves", "wifi"], ["existing electrical grid", "wifi"]]',
                },
                {
                    "role": "user",
                    "content": f"output: {output}, system:{syslist},environment:{env}",
                },
            ],
            response_format=IOList,
            temperature=1,
            max_tokens=2048,
            top_p=1,
            frequency_penalty=0,
            presence_penalty=0,
            n=Task.randomNumber,
        )
        return response.choices[0].message.parsed

    async def eval_io(self, env: str, io, syslist: list, number: int) -> list:
        response = await self.completion(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": f"Please evaluate the input-output pairs you generated. \
                     And please help me narrow down to {number} pairs. Here are some approach to optimization:\
                        1. Remove near-duplicates or synonyms. \
                        2. Consider site-specific conditions: identify key challenges and opportunities of the site (e.g. water scarcity, biodiversity loss, or urban heat) \
                        3. Interconnectivity: Focus on strategies that provide co-benefits or cascade effects (e.g., trees for shade, carbon sequestration, and air quality improvement).\
                        4. Sustainability goals \
                        5. Make sure there are input and output for different systems.\
                    And please output the narrowed list in this format: input->output",
                },
                {
                    "role": "user",
                    "content": f"environment: '{env}', io:{io}, system:{syslist}",
                },
            ],
            response_format=IOList,
            temperature=0,
            max_tokens=1024,
            top_p=1,
            frequency_penalty=0,
            presence_penalty=0,
            n=Task.randomNumber,
        )
        return response.choices[0].message.parsed


if __name__ == "__main__":
    pass
