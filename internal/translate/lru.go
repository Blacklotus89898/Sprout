package translate

import (
	"container/list"
	"sync"
)

// lru is a small, mutex-guarded LRU of translation results.
type lru struct {
	mu    sync.Mutex
	cap   int
	order *list.List
	items map[string]*list.Element
}

type entry struct {
	key string
	val *Result
}

func newLRU(capacity int) *lru {
	return &lru{cap: capacity, order: list.New(), items: map[string]*list.Element{}}
}

func (c *lru) get(k string) (*Result, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if e, ok := c.items[k]; ok {
		c.order.MoveToFront(e)
		return e.Value.(*entry).val, true
	}
	return nil, false
}

func (c *lru) put(k string, v *Result) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if e, ok := c.items[k]; ok {
		e.Value.(*entry).val = v
		c.order.MoveToFront(e)
		return
	}
	c.items[k] = c.order.PushFront(&entry{k, v})
	if c.order.Len() > c.cap {
		last := c.order.Back()
		c.order.Remove(last)
		delete(c.items, last.Value.(*entry).key)
	}
}
