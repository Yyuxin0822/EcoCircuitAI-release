import numpy as np
from collections import deque, defaultdict

class Graph:
    def __init__(self):
        # Using a dictionary to store adjacency lists:
        # key = node, value = list of neighbors
        self.adj_list = {}

    def add_vertex(self, vertex):
        """
        Add a single vertex to the graph if it does not already exist.
        """
        if vertex not in self.adj_list:
            self.adj_list[vertex] = []

    def add_edge(self, src, dest):
        """
        Add a directed edge from src to dest if it doesn't already exist.
        Automatically adds the vertices if they are not present.
        """
        if src not in self.adj_list:
            self.add_vertex(src)
        if dest not in self.adj_list:
            self.add_vertex(dest)
        if dest not in self.adj_list[src]:  # Check for duplicates
            self.adj_list[src].append(dest)

    def _dfs_util(self, current, visited):
        """
        A helper DFS function to mark visited nodes from the starting node.
        """
        visited.add(current)
        for neighbor in self.adj_list[current]:
            if neighbor not in visited:
                self._dfs_util(neighbor, visited)
            
    def get_unvisited_nodes(self, start_or_starts):
            """
            If 'start_or_starts' is a string, return unvisited nodes from that single node.
            If 'start_or_starts' is a list, return unvisited nodes from all nodes in the list.
            """
            if isinstance(start_or_starts, str):
                # Single start node
                visited = set()
                if start_or_starts in self.adj_list:
                    self._dfs_util(start_or_starts, visited)
                return [node for node in self.adj_list if node not in visited]

            elif isinstance(start_or_starts, list):
                # Multiple start nodes
                unvisited_nodes = set(self.adj_list.keys())
                for node in start_or_starts:
                    # For each node, do the DFS to find unvisited
                    single_unvisited = self.get_unvisited_nodes(node)
                    unvisited_nodes.intersection_update(single_unvisited)
                return list(unvisited_nodes)

            else:
                raise TypeError("'start_or_starts' must be either a str or a list of str.")

    def _all_paths_util(self, current, visited, path, all_paths):
        """
        A backtracking helper function to find all simple paths
        (no repeated vertices) from a starting node.
        """
        # Mark the current node as visited and add it to current path
        visited.add(current)
        path.append(current)

        # If there are no outgoing edges or all neighbors are visited,
        # we record the current path as one complete path.
        if not self.adj_list[current]:
            all_paths.append(path[:])
        else:
            # Try next moves
            for neighbor in self.adj_list[current]:
                if neighbor not in visited:
                    self._all_paths_util(neighbor, visited, path, all_paths)

        # Backtrack: remove current node from path and visited set
        path.pop()
        visited.remove(current)

    def print_all_paths_from(self, start):
        """
        Print out all possible simple paths beginning at 'start'.
        """
        if start not in self.adj_list:
            print(f"Node {start} does not exist in the graph.")
            return

        all_paths = []
        self._all_paths_util(start, set(), [], all_paths)

        print(f"All paths starting from node '{start}':")
        for idx, p in enumerate(all_paths, 1):
            print(f"Path {idx}: {' -> '.join(p)}")

    def get_all_edges(self):
        """
        Print out all edges in the graph.
        """
        edges = []
        for node, neighbors in self.adj_list.items():
            for neighbor in neighbors:
                edges.append([node, neighbor])
        return edges        

    def get_all_vertices(self):
        """
        Print out all vertices in the graph.
        """
        return list(self.adj_list.keys())
    
    def _assign_bfs_levels(self, source):
        """
        Standard BFS from 'source' to assign levels to reachable nodes.
        Returns:
          visited: set of visited nodes
          node_level: dict, node -> level
        """
        visited = set()
        node_level = {}
        queue = deque([(source, 0)])
        visited.add(source)
        node_level[source] = 0

        while queue:
            node, lvl = queue.popleft()
            for neighbor in self.adj_list[node]:
                if neighbor not in visited:
                    visited.add(neighbor)
                    node_level[neighbor] = lvl + 1
                    queue.append((neighbor, lvl + 1))
        return visited, node_level

    def _assign_unreachable_levels(self, visited, node_level):
        """
        For all unreachable nodes, determine if there's an edge from that node 
        to any visited node. If so, place it one level before the visited node(s).
        If there's more than one possible visited neighbor, pick the smallest level
        among them to ensure it's placed as far left (smallest level) as possible.

        If an unreachable node has no edges to visited nodes, place it to the far right
        of the graph (i.e., level = max(node_level.values()) + 1).
        
        This method mutates node_level by adding entries for unreachable nodes.
        """
        all_nodes = set(self.adj_list.keys())
        unreachable = all_nodes - visited
        if not unreachable:
            return  # Nothing to do

        max_reachable_level = max(node_level.values()) if node_level else 0

        for ur_node in unreachable:
            # Find visited neighbors that the unreachable node points TO.
            # i.e., edges of the form ur_node -> v (where v in visited)
            visited_targets = []
            for v in self.adj_list[ur_node]:
                if v in visited:
                    visited_targets.append(v)

            if visited_targets:
                # The unreachable node is "upstream" of visited_targets.
                # Place ur_node one level before the min( visited_target_level ).
                min_level = min(node_level[v] for v in visited_targets)
                new_level = min_level - 1  # place it "one to the left"
            else:
                # No visited targets => place it far right
                new_level = max_reachable_level + 1

            node_level[ur_node] = new_level

        # Now mark these unreachable nodes as visited so we can consider them in the final matrix.
        visited.update(unreachable)
    
    
    def create_erd_matrix(self, source, target=None):
        """
        Create an ERD-style matrix representation of the graph starting from the given source.
        If a target node is provided, place it at the far right (max_level + 1).
        Ensures no empty levels in the final output.
        """
        if source not in self.adj_list:
            # Use the first node in the graph as the source if the source is not valid
            source = list(self.adj_list.keys())[0]

        if target and target not in self.adj_list:
            target = list(self.adj_list.keys())[-1]
        
        # Step 1: Run BFS from the source to determine levels for reachable nodes
        visited, node_level = self._assign_bfs_levels(source)

        # Step 2: Assign levels for unreachable nodes
        self._assign_unreachable_levels(visited, node_level)

        # Step 3: If target is provided, place it at max_level + 1
        if target:
            max_level = max(node_level.values()) if node_level else 0
            node_level[target] = max_level + 1

        # Step 4: Organize nodes by levels
        levels_dict = defaultdict(list)
        for node, lvl in node_level.items():
            levels_dict[lvl].append(node)

        # Step 5: Rebase levels to remove any empty levels
        sorted_levels = sorted(levels_dict.keys())
        rebase_mapping = {lvl: i for i, lvl in enumerate(sorted_levels)}
        rebased_levels_dict = {rebase_mapping[lvl]: levels for lvl, levels in levels_dict.items()}

        # Step 6: Determine the maximum number of nodes in a single level
        max_nodes_in_a_level = max(len(nodes) for nodes in rebased_levels_dict.values())

        # Step 7: Initialize a matrix and populate it
        num_levels = len(rebased_levels_dict)
        matrix = np.full((num_levels, max_nodes_in_a_level), None, dtype=object)

        for row_index, nodes in rebased_levels_dict.items():
            for col_index, node in enumerate(nodes):
                matrix[row_index][col_index] = node

        return matrix.T

    
# -----------------------------
# Example usage:
# -----------------------------

if __name__ == "__main__":
    g = Graph()
    # Add some edges (directed)
    g.add_edge("A", "B")
    g.add_edge("A", "C")
    g.add_edge("B", "D")
    g.add_edge("C", "D")
    g.add_edge("D", "E")

    # Print all paths starting from "A"
    g.print_all_paths_from("A")

    # Find unvisited nodes from "A"
    unvisited = g.get_unvisited_nodes("A")
    print(f"Unvisited nodes from 'A': {unvisited}")
