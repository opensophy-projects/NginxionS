 

#ifndef __TRANSACTION_TABLE_METRIC_H__
#define __TRANSACTION_TABLE_METRIC_H__

#include "generic_metric.h"

class TransactionTableEvent : public Event<TransactionTableEvent>
{
public:
    void
    setTransactionTableSize(uint64_t _value)
    {
        transaction_table_size = _value;
    }

    uint64_t
    getTransactionTableSize() const
    {
        return transaction_table_size;
    }

private:
    uint64_t transaction_table_size = 0;
};

class TransactionTableMetric
        :
    public GenericMetric,
    public Listener<TransactionTableEvent>
{
public:
    void
    upon(const TransactionTableEvent &event) override
    {
        max_transaction_table_size.report(event.getTransactionTableSize());
        avg_transaction_table_size.report(event.getTransactionTableSize());
        last_report_transaction_handler_size.report(event.getTransactionTableSize());
    }

private:
    MetricCalculations::Max<uint64_t> max_transaction_table_size{this, "maxTransactionTableSizeSample", 0};
    MetricCalculations::Average<double> avg_transaction_table_size{this, "averageTransactionTableSizeSample"};
    MetricCalculations::LastReportedValue<uint64_t> last_report_transaction_handler_size{
        this,
        "lastReportTransactionTableSizeSample"
    };
};

#endif // __TRANSACTION_TABLE_METRIC_H__
