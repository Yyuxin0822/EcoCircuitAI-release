from flaskr.ecocircuit.method import Task
from pydantic import BaseModel
from typing import Dict, List
import asyncio


class SortSystem(BaseModel):
    system: List[str]


class System(BaseModel):
    name: str
    system: str


class SystemList(BaseModel):
    system: List[System]


class SystemTask(Task):
    task_message = "Classifying resource system ..."
    def __init__(self, clientasync=None, usage_tracker=None):
        super().__init__(clientasync, usage_tracker)
        self.name = "nodesystem"


    async def gen_output(self, data):
        resourceio = [io for i in data["io"].iolist for io in (i.input, i.output)] if data.get("io") else []
        resourcecoop = [r for i in data["coop"].flow for r in i.resources and i.synergy] if data.get("coop") else []
        resourceprocess = [r for flow in data["process"] for i in flow.flow for r in i] if data.get("process") else []
        methodname = [flow.method for flow in data["process"]] if data.get("process") else []
        resourcefeedback = [r for i in data["feedback"].loop for r in i.flow] if data.get("feedback") else []
        circularflowname = [i.name for i in data["feedback"].loop] if data.get("feedback") else []
        node = list(set(resourceio+resourcecoop + resourceprocess + resourcefeedback + methodname + circularflowname))
        
        if node == []:
            return

        self.output = await self.gensystem(node, data["syslist"])

        # sorted_system_list = await SystemTask.sortsystem(self.clientasync, data["syslist"])
        # data["syslist"] = self.output.system

    def parse_output(self):
        self.parsed_output = self.output

    def test_output(self):
        return True

    async def gensystem(self, node: list, system: list):
        n = 60
        nested_node = [node[i : i + n] for i in range(0, len(node), n)]
        tasks = [self.gensystem_chunck(sublist, system) for sublist in nested_node]
        results = await asyncio.gather(*tasks)
        
        combined_system_list = SystemList(system=[])
        for result in results:
            combined_system_list.system.extend(result.system)
        
        return combined_system_list
    
    async def gensystem_chunck(self, node: list, system: list):
        """return system classification of elements"""
        response = await self.completion(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": f"""You are an encyclopedia. Your job is to classify the node list into system.""",
                },
                {
                    "role": "user",
                    "content": 'nodelist: ["Cheetah", "wildlife corridors", "wadis"], system:["HYDRO", "ECOSYSTEM"]',
                },
                {
                    "role": "assistant",
                    "content": '[["Cheetah","ECOSYSTEM"], ["wildlife corridors","ECOSYSTEM"], ["wadis", "HYDRO"]]',
                },
                {
                    "role": "user",
                    "content": 'nodelist: ["forest", "irrigation", "organic waste", "biofuel"], system:["HYDRO", "ECOSYSTEM", "SOLID WASTE","ENERGY"]',
                },
                {
                    "role": "assistant",
                    "content": '[["forest","ECOSYSTEM"], ["irrigation","HYDRO"], ["organic waste", "SOLID WASTE"], ["biofuel", "ENERGY"]]',
                },
                {"role": "user", "content": f"nodelist:{node}, system:{system}"},
            ],
            response_format=SystemList,
            temperature=1,
            max_tokens=4096,
            top_p=1,
            frequency_penalty=0,
            presence_penalty=0,
        )
        return response.choices[0].message.parsed
