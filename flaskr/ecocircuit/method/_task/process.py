from flaskr.ecocircuit.method import Task
from pydantic import BaseModel
from typing import Dict, List
import asyncio
from collections import defaultdict
from flaskr.ecocircuit.utils import async_memoize


class Method(BaseModel):
    source: str
    target: str
    method: str
    methoddescription: str
class FlowERD(BaseModel):
    source: str
    target: str
    method: str
    flow: List[List[str]]
class Process(BaseModel):
    method: List[Method]

class SelectedProcess(BaseModel):
    methoddescription: List[str]
class ProcessTask(Task):
    task_message = "Generating system environmental methods and processes ..."
    
    def __init__(self, clientasync=None, usage_tracker=None):
        super().__init__(clientasync, usage_tracker)
        self.name = "process"

    async def gen_output(self, data):
        if not data.get("io") or not data.get("env") or not data.get("syslist"):
            return None
        print("running process task")
        # gen subprocess
        tasks = [
            self.gen_subprocess(data["env"], [iopair.input, iopair.output])
            for iopair in data["io"].iolist
        ]
        results = await asyncio.gather(*tasks)
        combined_process = Process(
            method=[method for process in results for method in process.method]
        )

        # eval process
        from flaskr.ecocircuit.method import SystemTask

        # I could classfiy the system of these methods here.
        # And then I can splite these methods into [n0, n0, n0, n0, n0] methods for each system
        # Then I could collect system here
        # I probably need to deal with the situation where there are not enough methods for each system

        system_task = SystemTask(clientasync=self.clientasync, usage_tracker=self.usage_tracker)
        method_description = [
            method.methoddescription for method in combined_process.method
        ]
        classify_mdescription_sys = await system_task.gensystem(
            method_description, data["syslist"]
        )
        classified_mdescription = defaultdict(list)
        for item in classify_mdescription_sys.system:
            classified_mdescription[item.system].append(item.name)

        # essentially I want to control methods generated equal to n0, if less, generate more, if more, reduce
        # temp_sys = set()
        # n0 = 5
        # n1 = 9
        # if len(classified_mdescription) > 30:
        #     for key, values in classified_mdescription.items():
        #         if len(values) < n0:
        #             temp_sys.add(key)
        #         elif len(values) > n1:
        #             classified_mdescription[key] = values[:n1]
        
        # allowed_descriptions = set(desc for descriptions in classified_mdescription.values() for desc in descriptions)

        # combined_process.method = [
        #     method for method in combined_process.method 
        #     if method.methoddescription in allowed_descriptions
        # ]
        
        n0=5
        tasks = [
            self.eval_process(values, data["env"], n0)
            for _, values in classified_mdescription.items()
        ]
        results = await asyncio.gather(*tasks)
        
        
        selected_processes = [
            method_description for result in results for method_description in result.methoddescription
        ]

        combined_process.method = [
            method
            for method in combined_process.method
            if method.methoddescription in selected_processes
        ]

        # then coombine the selected processes with the combined process



        # I want to update data["io"].iolist, so that it is
        # updated with the selected processes
        # data["io"].iolist.input is method.source, data["io"].iolist.output is method.target
        # I want to update data["io"].iolist.input and data["io"].iolist.output with the selected processes
        from flaskr.ecocircuit.method import IOList, IO

        data["io"] = IOList(
            iolist=[
                IO(input=method.source, output=method.target)
                for method in combined_process.method
            ]
        )
        

        # gen erd for selected methods
        erd_tasks = [
            self.gen_erd(
                method.source,
                method.target,
                method.method,
                method.methoddescription,
                data["env"],
            )
            for method in combined_process.method
        ]
        self.output = await asyncio.gather(*erd_tasks)
        self.output=self.parse_erd(self.output, data["io"].iolist)
        return self

    def parse_output(self):
        self.parsed_output = self.output

    def test_output(self):
        return True

    @async_memoize
    async def gen_subprocess(self, env: str, io):
        response = await self.completion(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": f"""You are an encyclopedia. You are to provide methods for generating output from input suitable for the environment provided.
                Please list three to four environmental technologies and a brief decription of generating the from input to output.
                Each method could be processes, resources, and technologies to transform input to output.
            """,
                },
                {
                    "role": "user",
                    "content": 'environment:"Desert Salt Flat Environment", input-output: ["BRINE","BASO4"]',
                },
                {
                    "role": "assistant",
                    "content": f"""To transform from source "BRINE" to target "BASO4" for "Desert Salt Flat Environment", we know methods: {{
                        "Chemical Precipitation": [
                            "By adding barium salts (e.g., BaCl2), the sulfate in brine forms insoluble BaSO4, which is filtered out."
                        ],
                        "Salt Evaporation Ponds": [
                            "Using solar evaporation ponds, **brine water undergoes** evaporation, concentrating salts and sulfates, leading to BaSO4 precipitation."
                        ],
                        "Membrane Filtration": [
                            "A semi-permeable membrane allows water to pass while concentrating/retaining BaSO4, aiding its separation."
                        ],
                        "Electrochemical Sulfate Removal": [
                            "An electric field drives sulfate ions into a separate stream, where barium addition precipitates BaSO4."
                        ]
                    }}""",
                },
                {
                    "role": "user",
                    "content": 'Environment:"IOWA farm land", input-output: ["WASTEWATER","AGRICULTURE"]',
                },
                {
                    "role": "assistant",
                    "content": f"""To transform from source "WASTEWATER" to target "AGRICULTURE" for "IOWA farm land", we know methods: {{
                        "Constructed Wetlands": [
                            "WASTEWATER is routed through natural or engineered wetlands to remove pollutants and excess nutrients, yielding water safe for crop irrigation."
                        ],
                        "Membrane Filtration": [
                            "Membrane systems remove harmful contaminants from WASTEWATER, producing a purified effluent that meets agricultural standards."
                        ],
                        "Anaerobic Digestion": [
                            "Organic matter in WASTEWATER is broken down by microbes in anaerobic conditions, creating biogas and nutrient-rich effluent for fields."
                        ],
                        "Nutrient Recovery": [
                            "Recovery systems extract nitrogen and phosphorus from WASTEWATER, turning it into valuable fertilizers for farmland."
                        ]
                    }}""",
                },
                {
                    "role": "user",
                    "content": 'Environment:"A Tech Company Campus", input-output: ["MOSS","HUMIDIFIER"]',
                },
                {
                    "role": "assistant",
                    "content": f"""To transform from source "MOSS" to target "HUMIDIFIER" for "A Tech Company Campus", we know methods: {{
                    "Living Moss Walls": [
                        "Vertical panels with irrigated moss release moisture through natural evapotranspiration, helping humidify interior spaces."
                    ],
                    "Passive Evaporation Panels": [
                        "Moss is grown on water-retaining substrates; gentle airflow over the moss increases localized humidity without mechanical systems."
                    ],
                    "Biophilic HVAC Integration": [
                        "Moss modules are incorporated into the ventilation system, naturally adding humidity as air circulates through the building."
                    ],
                    "Hydroponic Moss Pods": [
                        "Suspended pods supply water to moss roots; the moss transpires water vapor into the atmosphere, effectively raising indoor humidity."
                    ]
                }}""",
                },
                {"role": "user", "content": f"environment:{env}, input-output:{io}"},
            ],
            response_format=Process,
            temperature=1,
            n=Task.randomNumber,
        )
        return response.choices[0].message.parsed

    @async_memoize
    async def gen_erd(
        self, source: str, target: str, method: str, methoddescription: str, env: str
    ):
        response = await self.completion(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": f"""Help me create an Entity Relationship Diagram (ERD) based on the provided description. Follow these rules:
                                    1. Entities: 1) Each entity must represent a potential tangible or digital resource in the given environment and explain the technical details of the methods described. 2)Avoid abstract concepts such as "improvement" or "enhancement."
                                        3) Be specific yet concise (within 48 characters). Example: Use "Salt Byproducts (Halite, Gypsum)" instead of "byproduct"; use "Injection Disposal Method" instead of "disposal method."
                                    2. Relationships: 1) Clearly define each relationship in a [source, target] format. 2) Include explicit starting ("source") and ending ("target") entities. 3) Ensure all relationships are logically connected and accurate.
                                    3. Scope: 1) Limit to a maximum of 6 entities. 2) The ERD should capture all critical resources and their dynamics concisely.
                                    4. Output Format: 1) Provide the ERD as a list of pairs: [source, target]. 2) Use double quotes for entity names and single quotes for relationship names.
                                    """,
                },
                {
                    "role": "user",
                    "content": """Environment: "geothermal spring",
                        to transform from source "Geothermal Brine" to target "BaSO₄", 
                        we know method "Chemical Precipitation Method", \
                        where "Geothermal Brine can transform to Baso4 through reproduction process.
                        """,
                },
                {
                    "role": "assistant",
                    "content": f"""To transform from source "Geothermal Brine" to target "BaSO₄", in the method "Chemical Precipitation Method" for the environment "geothermal spring", ERD relationships include: 
                        [["Geothermal Brine", "Precipitation Process"],
                         ["Underground Heat Source", "Precipitation Process"],
                         ["Natural Reagent (e.g., Dissolved Sulfate)", "Precipitation Process"],
                         ["Precipitation Process", "BaSO₄"],
                         ["Precipitation Process", "Byproduct (e.g., Silica Deposits)"],
                         ["Byproduct (e.g., Silica Deposits)", "Disposal or Reuse Method"]]
                    """,
                },
                {
                    "role": "user",
                    "content": """Environment: "desert salt flat"
                    To transform from source "Brine" to target "BaSO₄", we know method "Salt Evaporation Ponds",\
                    where "Using solar evaporation ponds, brine water undergoes evaporation, concentrating the salts and sulfates which leads to the precipitation of minerals like BaSO4."
                    """,
                },
                {
                    "role": "assistant",
                    "content": f"""To transform from source "Brine" to target "BaSO₄", in the method "Salt Evaporation Ponds" for the environment "desert salt flat", ERD relationships include: 
                        [["Brine", "Salt Evaporation Process"],
                         ["Salt Evaporation Process", "Evaporation Pond"],
                         ["Evaporation Pond", "Desert Salt Flat Environment"], 
                         ["Desert Salt Flat Environment", "Weather Conditions (e.g. High Solar Radiation, Low Humidity)"],
                         ["Weather Conditions (e.g. High Solar Radiation, Low Humidity)", "Evaporation Rate"],
                         ["Salt Evaporation Process", "Concentrated Solutions"],
                         ["Concentrated Solutions", "BaSO₄"],
                         ["Concentrated Solutions", "Salt Byproducts (e.g. Halite, Gypsum)"],
                         ["Salt Byproducts (e.g. Halite, Gypsum)", "Disposal Method (e.g. Landfill, Recycling, Sold)"]]
                        """,
                },
                {
                    "role": "user",
                    "content": """Environment: Industrial Water Treatment Facility
                    To transform from source "Brine" to target "BaSO₄", we know method "Ion Exchange Process",\
                    where "Brine is passed through an ion exchange column which captures sulfate ions and, \ 
                    through a chemical exchange reaction, precipitates BaSO4."
                    """,
                },
                {
                    "role": "assistant",
                    "content": f"""To transform from source "Brine" to target "BaSO₄", in the method "Ion Exchange Process" for the environment "Industrial Water Treatment Facility", ERD relationships include: 
                        [
                            ["Brine", "Ion Exchange Process"],
                            ["Ion Exchange Process", "Industrial Water Treatment Facility"],
                            ["Ion Exchange Process", "Ion Exchange Column"],
                            ["Ion Exchange Column", "Resin"],
                            ["Ion Exchange Process", "BaSO₄"],
                            ["Ion Exchange Process", "Ion Exchange Waste (e.g., Regenerant Solution)"],
                            ["Ion Exchange Waste (e.g., Regenerant Solution)", "Disposal Method (e.g., Deep Well Injection, Further Treatment)"]
                        ]
                    """,
                },
                {
                    "role": "user",
                    "content": f"Environment: {env}. To transform from source {source} to target {target}, we know method {method}, where {methoddescription}",
                },
            ],
            response_format=FlowERD,
            temperature=1,
            n=Task.randomNumber,
        )
        return response.choices[0].message.parsed

    @async_memoize
    async def eval_process(self, process: list, env: str, number: int):
        response = await self.completion(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": f"Please help me evaluate the environmental relevance of these environmental engineering methods. \
                     And please help me narrow down the list to {number} methods. Here are some approach to optimization:\
                        1. Remove near-duplicates or synonyms. \
                        2. Consider site-specific conditions: identify key challenges and opportunities of the site and make sure these methods help solve the challenges. \
                        3. Interconnectivity: Focus on strategies that provide co-benefits or cascade effects.\
                        4. Diversity of sustainability goals those methods could help achieve. \
                    And please output the narrowed list in this format: [method1, method2, method3, ...] When you output, group similar methods closer to each other.",
                },
                {
                    "role": "user",
                    "content": f"environment: '{env}', methods:{process}",
                },
            ],
            response_format=SelectedProcess,
            temperature=0,
            max_tokens=1024,
            top_p=1,
            frequency_penalty=0,
            presence_penalty=0,
            n=Task.randomNumber,
        )
        return response.choices[0].message.parsed

    @staticmethod
    def parse_erd(processlist: list, io: list):
        if not len(processlist) == len(io):
            print("The process list and io list are not the same length")
            return None

        for i in range(len(processlist)):
            word_src = processlist[i].source
            word_tgt = processlist[i].target
            processlist[i].source = io[i].input.upper()
            processlist[i].target = io[i].output.upper()
            for wordlist in processlist[i].flow:
                for j in range(len(wordlist)):
                    if wordlist[j] == word_src:
                        wordlist[j] = io[i].input.upper()
                    if wordlist[j] == word_tgt:
                        wordlist[j] = io[i].output.upper()
        return processlist


if __name__ == "__main__":
    pass
    # task = ProcessTask()
    # task = solve(task)
    # print(task.output)

    # task = ProcessTask()
    # task.input = [["BRINE", "BASO4"]]
    # process_result = asyncio.run(task.solve({"io": task.input}))
    # print(task.solve({"io": task.input}))
