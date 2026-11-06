from flaskr.ecocircuit.method import Task
from pydantic import BaseModel
from typing import Dict, List


class CircularFlow(BaseModel):
    name: str
    flow: List[str]


class Feedback(BaseModel):
    loop: List[CircularFlow]


class FeedbackTask(Task):
    task_message = "Identifying circular reuse opportunities ..."

    def __init__(self, clientasync=None, usage_tracker=None):
        super().__init__(clientasync, usage_tracker)
        self.name = "feedback"

    async def gen_output(self, data) -> str:
        resourceprocess = [r for flow in data["process"] for i in flow.flow for r in i]
        resource = list(set(resourceprocess))
        self.output = await self.genfeedback(str(resource))
        return self

    def parse_output(self):
        self.parsed_output = self.output
        return self

    def test_output(self):
        return True

    async def genfeedback(self, input: str):
        """return co-optimized resources from input

        Args:
        nodelist(list converted str)
        """
        response = await self.completion(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": 'You are an environmental engineering specialist for regenerative environments. I will provide a list of resource nodes that represent environmental assets or opportunities. \
                Your task is to identify circular loops between these nodes to create a regenerative loop. Please suggest the circular relationship, it could be composed of two or many nodes. \
                Please present the results in the form of a circular linked list structure. \
                Example format is like below and please ensure the start and end is the same:\
                {"XX Loop": ["Node1","Node2","Node3", "Node1"], "XX Loop": ["Node4", "Node5", "Node6", "Node4"]}',
                },
                {
                    "role": "user",
                    "content": "['RAINWATER', 'ORGANIC EDIBLES', 'ORGANIC MATTER', 'HABITAT PROTECTION', 'SOIL NUTRIENTS', \
                    'WIND ENERGY', 'CARBON SEQUESTRATION', 'ANIMAL FEED', 'WAVES', 'SAND', 'PLANT BIODIVERSITY', 'SEA BREEZES', 'SEA LIFE', \
                    'DISPOSER', 'TOURIST ATTRACTION', 'ROCKS', 'CONSTRUCTION MATERIAL', 'SHELLS', 'EROSION CONTROL', 'SOLAR ENERGY', 'TOPOGRAPHY', \
                    'INDIGENOUS PLANTS', 'IMPROVED HUMAN HEALTH', 'RAINWATER COLLECTING SYSTEMS', 'COASTAL PROTECTION', 'GROUND COVER', 'PHOTOVOLTAIC PANELS', \
                    'NATURAL LIGHTING', 'SHORES', 'SALTWATER', 'BEACH', 'POLLINATORS', 'NUTRIENT EXTRACTION', 'RECYCLABLE', 'REDUCED STORMWATER RUNOFF', \
                    'WIND TURBINES', 'BAMBOO MATERIAL', 'FOOTPRINTS', 'AGRICULTURE', 'SOLAR HOT WATER', 'FOOD SOURCE', 'MARINE BIODIVERSITY', 'WILDLIFE', \
                    'JOB CREATION', 'COMPOST', 'SUNLIGHT', 'GREEN ROOFS', 'CARBON DIOXIDE REDUCTION', 'IRRIGATION', 'THERMAL ENERGY', 'BAMBOO', 'CLEAN AIR', \
                    'SEDIMENT', 'AESTHETIC PLEASURE', 'BIRD SPECIES', 'PLANT SPECIES', 'THERMAL HEATING', 'SOIL', 'ECO-FRIENDLY MATERIALS', 'GARDENS', 'SEAGRASS', \
                    'SUN ENERGY', 'DURABLE GRASS', 'TOURISM', 'SEDUM', 'OCEAN', 'SEAWEED', 'COASTAL ISLAND']",
                },
                {
                    "role": "assistant",
                    "content": '"Rainwater Loop": ["RAINWATER", "RAINWATER COLLECTING SYSTEMS", "IRRIGATION", "SOIL NUTRIENTS", "ORGANIC EDIBLES", "ORGANIC MATTER", "COMPOST", "RAINWATER"],\
                    "Marine Ecosystem Loop": ["SEAWEED", "MARINE BIODIVERSITY", "SEA LIFE", "NUTRIENT EXTRACTION", "ORGANIC MATTER", "SEAWEED"],\
                    "Energy Loop": ["SOLAR ENERGY", "PHOTOVOLTAIC PANELS", "CLEAN AIR", "IMPROVED HUMAN HEALTH", "JOB CREATION", "SOLAR HOT WATER", "SOLAR ENERGY"],\
                    "Coastal Protection Loop": ["COASTAL PROTECTION", "SAND", "SHELLS", "CONSTRUCTION MATERIAL", "EROSION CONTROL", "COASTAL ISLANDS", "COASTAL PROTECTION"],\
                    "Bamboo Sustainability Loop": ["BAMBOO", "BAMBOO MATERIAL", "ECO-FRIENDLY MATERIALS", "CONSTRUCTION MATERIAL", "CARBON SEQUESTRATION", "BAMBOO"],\
                    "Biodiversity Loop": ["PLANT BIODIVERSITY", "POLLINATORS", "INDIGENOUS PLANTS", "HABITAT PROTECTION", "WILDLIFE", "PLANT BIODIVERSITY"],\
                    "Tourism and Environment Loop": ["TOURIST ATTRACTION", "BEACH", "SHORE", "AESTHETIC PLEASURE", "MARINE BIODIVERSITY", "TOURISM", "TOURIST ATTRACTION"],\
                    "Sediment and Land Restoration Loop": ["SEDIMENT", "ROCKS", "SOIL", "GROUND COVER", "HABITAT PROTECTION", "SEDIMENT"],\
                    "Renewable Energy Loop": ["WIND ENERGY", "WIND TURBINES", "REDUCED STORMWATER RUNOFF", "RAINWATER", "WIND ENERGY"],\
                    "Green Roof Loop": ["GREEN ROOFS", "NATURAL LIGHTING", "CLEAN AIR", "CARBON DIOXIDE REDUCTION", "IMPROVED HUMAN HEALTH", "GREEN ROOFS"]',
                },
                {
                    "role": "user",
                    "content": input,
                },
            ],
            response_format=Feedback,
            temperature=0.5,
            max_tokens=4096,
            top_p=1,
            frequency_penalty=0.2,
            presence_penalty=0,
            n=Task.randomNumber,
        )
        return response.choices[0].message.parsed


if __name__ == "__main__":
    pass
