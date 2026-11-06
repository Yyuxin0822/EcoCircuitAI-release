import os
from functools import partial
from flaskr.ecocircuit.utils import async_completions_with_backoff
import random
import asyncio
import logging

DATA_PATH = os.path.join(os.path.dirname(__file__), "..", "data")


class Task:
    randomNumber = 1

    def __init__(self, clientasync=None, usage_tracker=None):
        self.clientasync = clientasync
        self.usage_tracker = usage_tracker
        self.name = "Task"
        self.output = None
        self.parsed_output = None

    async def completion(self, **kwargs):
        return await async_completions_with_backoff(
            self.clientasync,
            self.usage_tracker,
            **kwargs
        )

    async def gen_output(self) -> str:
        pass

    def parse_output(self):
        pass

    def test_output(self):
        pass

    async def solve(self, data, max_tries=3, to_print=True):
        await self.gen_output(data)
        self.parse_output()
        if self.test_output():
            print(f"Solved task {self.name}")
            print(f"Output: {self.parsed_output}")
            data[self.name] = self.parsed_output
            return data
        # for _ in range(max_tries):
        #     try:
        #         await self.gen_output(data)
        #         self.parse_output()
        #         if self.test_output():
        #             print(f"Solved task {self.name}")
        #             print(f"Output: {self.parsed_output}")
        #             data[self.name] = self.parsed_output
        #             return data
        #     except Exception as e:
        #         print(f"Failed to solve task {self.name}")

        # print(f"Failed to solve task {self.name} after {max_tries} tries")
        return None
